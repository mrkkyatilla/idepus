import { getActiveRunId } from "../agent/client";
import { canSwitchSession } from "../agent/session-switch";
import {
  closeSession,
  createSession,
  getActiveSessionId,
  getOpenTabCount,
  restoreClosedSession,
  setSavedLocallyFlash,
} from "../chat/session-store";
import type { ChatSession } from "../chat/session-types";
import { MAX_OPEN_TABS } from "../chat/session-types";
import { mountChatSessionHub } from "./agent/chat-session-hub";
import { mountChangesHub } from "./agent/changes-hub";
import { mountHistoryDrawer } from "./agent/history-drawer";
import { setChangesHubOpener } from "../memory/ui-bus";
import { initTaskTracker, mountTaskTracker, refreshSidecarBanner } from "./task-tracker";
import type { TaskTrackerHost } from "./task-tracker";

const WIDTH_KEY = "idepus.agentPanelWidth";
const OPEN_KEY = "idepus.agentPanelOpen";
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;

export type AgentPanel = {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  remountTasks: () => void;
  setStatus: (state: "idle" | "running" | "hitl") => void;
  createNewChatTab: () => Promise<void>;
  closeActiveChatTab: () => Promise<void>;
  undoCloseChatTab: () => Promise<boolean>;
  toggleHistory: () => void;
  openChangesHub: (filter?: { runId?: string; query?: string }) => void;
};

function loadWidth(): number {
  const raw = localStorage.getItem(WIDTH_KEY);
  const n = raw ? Number(raw) : DEFAULT_WIDTH;
  if (!Number.isFinite(n)) {
    return DEFAULT_WIDTH;
  }
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
}

function loadOpen(): boolean {
  const raw = localStorage.getItem(OPEN_KEY);
  if (raw === null) {
    return true;
  }
  return raw === "1";
}

export function createAgentPanel(
  panelEl: HTMLElement,
  taskHost: TaskTrackerHost,
  onOpenChange?: (open: boolean) => void,
): AgentPanel {
  initTaskTracker(taskHost);

  panelEl.className = "agent-panel";
  panelEl.innerHTML = "";

  const resizer = document.createElement("div");
  resizer.className = "agent-panel-resizer";
  resizer.title = "Drag to resize";

  const inner = document.createElement("div");
  inner.className = "agent-panel-inner";

  const header = document.createElement("div");
  header.className = "agent-panel-header";

  const headerStack = document.createElement("div");
  headerStack.className = "agent-panel-header-stack";

  const nav = document.createElement("div");
  nav.className = "agent-panel-nav";
  nav.setAttribute("role", "toolbar");
  nav.setAttribute("aria-label", "Chat navigation");

  const newChatBtn = document.createElement("button");
  newChatBtn.type = "button";
  newChatBtn.className = "btn btn-ghost btn-sm agent-panel-nav-btn";
  newChatBtn.textContent = "New chat";
  newChatBtn.title = "New chat (⌘⇧I)";

  const chatsBtn = document.createElement("button");
  chatsBtn.type = "button";
  chatsBtn.className = "btn btn-ghost btn-sm agent-panel-nav-btn";
  chatsBtn.textContent = "Chats";
  chatsBtn.title = "Chat history";

  const changesBtn = document.createElement("button");
  changesBtn.type = "button";
  changesBtn.className = "btn btn-ghost btn-sm agent-panel-nav-btn";
  changesBtn.textContent = "Changes";
  changesBtn.title = "Accepted change memory";

  const historyBtn = document.createElement("button");
  historyBtn.type = "button";
  historyBtn.className = "btn btn-ghost btn-sm agent-panel-nav-btn";
  historyBtn.textContent = "Run history";
  historyBtn.title = "Run history";

  nav.append(newChatBtn, chatsBtn, changesBtn, historyBtn);

  const statusDot = document.createElement("span");
  statusDot.className = "status-dot status-dot--idle agent-panel-status";
  statusDot.setAttribute("aria-hidden", "true");

  const savedBadge = document.createElement("span");
  savedBadge.className = "agent-saved-badge";
  savedBadge.hidden = true;
  savedBadge.textContent = "Saved locally";

  headerStack.append(nav);

  const headerActions = document.createElement("div");
  headerActions.className = "agent-panel-header-actions";
  headerActions.append(statusDot, savedBadge);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-ghost btn-icon agent-panel-close";
  closeBtn.title = "Hide agent panel";
  closeBtn.textContent = "×";

  header.append(headerStack, headerActions, closeBtn);

  const body = document.createElement("div");
  body.className = "agent-panel-body";
  body.id = "agent-panel-host";

  const bodyMain = document.createElement("div");
  bodyMain.className = "agent-panel-body-main";

  const bodyOverlays = document.createElement("div");
  bodyOverlays.className = "agent-panel-body-overlays";

  body.append(bodyMain, bodyOverlays);

  inner.append(header, body);
  panelEl.append(resizer, inner);

  let savedFlashTimer: ReturnType<typeof setTimeout> | null = null;
  setSavedLocallyFlash(() => {
    savedBadge.hidden = false;
    if (savedFlashTimer) {
      clearTimeout(savedFlashTimer);
    }
    savedFlashTimer = setTimeout(() => {
      savedBadge.hidden = true;
      savedFlashTimer = null;
    }, 2000);
  });

  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRestore: ChatSession | null = null;

  async function createNewChatTab(): Promise<void> {
    if (getOpenTabCount() >= MAX_OPEN_TABS) {
      taskHost.onStatus(`Maximum ${MAX_OPEN_TABS} chat tabs open — close one in Chats first`);
      return;
    }
    try {
      closeAllOverlays();
      await createSession();
      taskHost.onStatus("New chat");
    } catch (err) {
      taskHost.onStatus(String(err));
    }
  }

  async function closeActiveChatTab(): Promise<void> {
    if (!canSwitchSession()) {
      taskHost.onStatus("Cancel the active run before closing this chat");
      return;
    }
    const current = getActiveSessionId();
    if (!current) {
      return;
    }
    const removed = await closeSession(current);
    if (!removed) {
      taskHost.onStatus("Cannot close the last chat — open another from Chats first");
      return;
    }
    if (undoTimer) {
      clearTimeout(undoTimer);
    }
    pendingRestore = removed;
    taskHost.onStatus("Chat closed — press ⌘Z within 5s to undo");
    undoTimer = setTimeout(() => {
      pendingRestore = null;
      undoTimer = null;
    }, 5000);
  }

  async function undoCloseChatTab(): Promise<boolean> {
    if (!pendingRestore) {
      return false;
    }
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    const session = pendingRestore;
    pendingRestore = null;
    if (getOpenTabCount() >= MAX_OPEN_TABS) {
      taskHost.onStatus(`Maximum ${MAX_OPEN_TABS} chats open`);
      return false;
    }
    await restoreClosedSession(session);
    taskHost.onStatus("Chat restored");
    return true;
  }

  const canSwitch = () => canSwitchSession();

  const chatHub = mountChatSessionHub(bodyOverlays, {
    onStatus: (message) => taskHost.onStatus(message),
    canSwitch,
  });

  let historyDrawer!: ReturnType<typeof mountHistoryDrawer>;

  const changesHub = mountChangesHub(bodyOverlays, {
    workspaceId: () => taskHost.getWorkspaceId?.(),
    onStatus: (message) => taskHost.onStatus(message),
    onOpenFile: (path) => taskHost.openFile(path),
    onViewRun: (runId) => {
      closeAllOverlays();
      void historyDrawer.openRunDetail(runId);
      historyDrawer.open();
    },
  });

  setChangesHubOpener((filter) => {
    closeAllOverlays();
    changesHub.open(filter);
  });

  historyDrawer = mountHistoryDrawer(bodyOverlays, {
    onStatus: (message) => taskHost.onStatus(message),
    onViewChanges: (runId) => {
      closeAllOverlays();
      changesHub.open({ runId });
    },
    onReturnToChat: () => closeAllOverlays(),
  });

  function closeAllOverlays(): void {
    chatHub.close();
    changesHub.close();
    historyDrawer.close();
  }

  function toggleOverlay(
    isOpen: () => boolean,
    openFn: () => void,
  ): void {
    if (isOpen()) {
      closeAllOverlays();
      return;
    }
    closeAllOverlays();
    openFn();
  }

  historyBtn.addEventListener("click", () => {
    if (historyDrawer.isOpen()) {
      historyDrawer.close();
      return;
    }
    closeAllOverlays();
    historyDrawer.open();
  });
  chatsBtn.addEventListener("click", () => {
    toggleOverlay(() => chatHub.isOpen(), () => chatHub.open());
  });
  changesBtn.addEventListener("click", () => {
    toggleOverlay(() => changesHub.isOpen(), () => changesHub.open());
  });

  newChatBtn.addEventListener("click", () => {
    void createNewChatTab();
  });

  let width = loadWidth();
  let open = loadOpen();
  let teardownTasks = mountTaskTracker(bodyMain);
  let bannerEl: HTMLElement | null = bodyMain.querySelector(".agent-sidecar-banner");

  function setStatus(state: "idle" | "running" | "hitl"): void {
    statusDot.className = "status-dot agent-panel-status";
    if (state === "running") {
      statusDot.classList.add("status-dot--running");
    } else if (state === "hitl") {
      statusDot.classList.add("status-dot--hitl");
    } else {
      statusDot.classList.add("status-dot--idle");
    }
  }

  const externalOnState = taskHost.onAgentStateChange;
  taskHost.onAgentStateChange = (agentState) => {
    setStatus(agentState);
    externalOnState?.(agentState);
  };

  function applyWidth(next: number): void {
    width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
    panelEl.style.width = `${width}px`;
    localStorage.setItem(WIDTH_KEY, String(width));
  }

  function applyOpen(next: boolean): void {
    open = next;
    panelEl.classList.toggle("collapsed", !open);
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    onOpenChange?.(open);
    if (open) {
      bannerEl = bodyMain.querySelector(".agent-sidecar-banner");
      if (bannerEl) {
        void refreshSidecarBanner(bannerEl);
      }
    }
  }

  applyWidth(width);
  applyOpen(open);
  setStatus("idle");

  let dragging = false;

  resizer.addEventListener("mousedown", (event) => {
    event.preventDefault();
    dragging = true;
    document.body.classList.add("agent-panel-resizing");
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }
    const rect = panelEl.getBoundingClientRect();
    const next = rect.right - event.clientX;
    applyWidth(next);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.classList.remove("agent-panel-resizing");
  });

  closeBtn.addEventListener("click", () => {
    closeAllOverlays();
    applyOpen(false);
  });

  return {
    show: () => applyOpen(true),
    hide: () => applyOpen(false),
    toggle: () => applyOpen(!open),
    isOpen: () => open,
    setStatus,
    createNewChatTab,
    closeActiveChatTab,
    undoCloseChatTab,
    toggleHistory: () => historyDrawer.toggle(),
    openChangesHub: (filter) => changesHub.open(filter),
    remountTasks() {
      teardownTasks();
      teardownTasks = mountTaskTracker(bodyMain);
      bannerEl = bodyMain.querySelector(".agent-sidecar-banner");
    },
  };
}
