import { getAgentMode } from "../../agent/mode";
import { modeLabel } from "../../agent/mode";
import {
  MAX_OPEN_TABS,
} from "../../chat/session-types";
import {
  deleteSessionPermanently,
  getActiveSessionId,
  getOpenTabCount,
  getWorkspaceSessionSummaries,
  isSessionOpen,
  openSessionFromHistory,
  subscribeChatSessions,
} from "../../chat/session-store";
import type { SessionSummary } from "../../chat/session-types";

export type ChatSessionHubMount = {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  destroy: () => void;
};

function formatUpdatedAt(ts: number): string {
  const date = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) {
    return "Just now";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }
  return date.toLocaleDateString();
}

export function mountChatSessionHub(
  hostEl: HTMLElement,
  options: {
    onStatus: (message: string) => void;
    canSwitch: () => boolean;
  },
): ChatSessionHubMount {
  const hub = document.createElement("div");
  hub.className = "agent-chat-hub";
  hub.hidden = true;

  const header = document.createElement("div");
  header.className = "agent-chat-hub-header";

  const title = document.createElement("h3");
  title.className = "agent-chat-hub-title";
  title.textContent = "Chats";

  const subtitle = document.createElement("span");
  subtitle.className = "agent-chat-hub-subtitle";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "btn btn-ghost btn-sm";
  backBtn.textContent = "Back to chat";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-ghost btn-icon agent-chat-hub-close";
  closeBtn.title = "Close";
  closeBtn.textContent = "×";

  const headerMain = document.createElement("div");
  headerMain.className = "agent-chat-hub-header-main";
  headerMain.append(title, subtitle);

  header.append(headerMain, backBtn, closeBtn);

  const list = document.createElement("div");
  list.className = "agent-chat-hub-list";
  list.setAttribute("role", "list");

  hub.append(header, list);
  hostEl.appendChild(hub);

  let open = false;
  let sessions: SessionSummary[] = [];
  let loading = false;

  function updateSubtitle(): void {
    const openCount = getOpenTabCount();
    subtitle.textContent = `${openCount}/${MAX_OPEN_TABS} tabs open`;
  }

  async function loadSessions(): Promise<void> {
    loading = true;
    render();
    try {
      sessions = await getWorkspaceSessionSummaries();
    } catch (err) {
      options.onStatus(`Failed to load chats: ${String(err)}`);
      sessions = [];
    } finally {
      loading = false;
      render();
    }
  }

  async function openSession(session: SessionSummary): Promise<void> {
    if (session.id === getActiveSessionId()) {
      close();
      return;
    }
    if (!options.canSwitch()) {
      options.onStatus("Finish or cancel the active agent run first");
      return;
    }
    const ok = await openSessionFromHistory(session.id);
    if (!ok) {
      options.onStatus("Could not open chat");
      return;
    }
    close();
    options.onStatus(`Opened: ${session.title}`);
  }

  async function deleteSession(session: SessionSummary): Promise<void> {
    if (!confirm(`Delete "${session.title}"? This cannot be undone.`)) {
      return;
    }
    const ok = await deleteSessionPermanently(session.id);
    if (!ok) {
      options.onStatus("Cannot delete the last open chat tab");
      return;
    }
    options.onStatus(`Deleted: ${session.title}`);
    await loadSessions();
  }

  function render(): void {
    list.innerHTML = "";
    updateSubtitle();

    if (loading) {
      const empty = document.createElement("p");
      empty.className = "agent-chat-hub-empty";
      empty.textContent = "Loading chats…";
      list.appendChild(empty);
      return;
    }

    if (sessions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "agent-chat-hub-empty";
      empty.textContent = "No chats yet. Start a new conversation.";
      list.appendChild(empty);
      return;
    }

    const activeId = getActiveSessionId();

    for (const session of sessions) {
      const wrap = document.createElement("div");
      wrap.className = "agent-chat-hub-row-wrap";

      const row = document.createElement("button");
      row.type = "button";
      row.className = "agent-chat-hub-row";
      row.setAttribute("role", "listitem");
      if (session.id === activeId) {
        row.classList.add("agent-chat-hub-row--active");
      }

      const main = document.createElement("div");
      main.className = "agent-chat-hub-row-main";

      const rowTitle = document.createElement("span");
      rowTitle.className = "agent-chat-hub-row-title";
      rowTitle.textContent = session.title;

      const meta = document.createElement("span");
      meta.className = "agent-chat-hub-row-meta";
      const openLabel = isSessionOpen(session.id) ? " · open tab" : "";
      meta.textContent = `${formatUpdatedAt(session.updatedAt)}${openLabel}`;

      main.append(rowTitle, meta);

      const badge = document.createElement("span");
      badge.className = `agent-chat-hub-mode agent-chat-hub-mode--${session.mode}`;
      badge.textContent = modeLabel(session.mode);

      row.append(main, badge);

      row.addEventListener("click", () => {
        void openSession(session);
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-ghost btn-icon agent-chat-hub-delete";
      delBtn.title = "Delete chat";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        void deleteSession(session);
      });

      wrap.append(row, delBtn);
      list.appendChild(wrap);
    }
  }

  function setVisible(visible: boolean): void {
    open = visible;
    hub.hidden = !visible;
    hub.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function openHub(): void {
    setVisible(true);
    void loadSessions();
  }

  function close(): void {
    setVisible(false);
  }

  backBtn.addEventListener("click", () => close());
  closeBtn.addEventListener("click", () => close());

  const unsubscribe = subscribeChatSessions(() => {
    if (open) {
      void loadSessions();
    } else {
      updateSubtitle();
    }
  });

  updateSubtitle();

  return {
    open: openHub,
    close,
    isOpen: () => open,
    destroy() {
      unsubscribe();
      hub.remove();
    },
  };
}
