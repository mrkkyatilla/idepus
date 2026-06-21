import { invoke } from "@tauri-apps/api/core";
import { EditorView } from "@codemirror/view";

import { initChatSessionsForWorkspace, flushSave } from "./chat/session-store";
import { restoreLatestPlanForWorkspace } from "./plan/store";
import { refreshMaxParallelRunsFromSettings } from "./agent/run-registry";
import { initCmdKContext, cancelActiveStream } from "./cmdk";
import type { DiffReviewSummary } from "./cmdk/diff-review";
import { isDiffReviewActive } from "./cmdk/diff-review";
import { bindDiffToolbar, updateDiffToolbar } from "./ui/diff-toolbar";
import { createEditor } from "./editor";
import {
  autocompleteControllerExtension,
  pauseAutocomplete,
  refreshAutocompleteConfig,
  resumeAutocomplete,
} from "./autocomplete/controller";
import { getActiveProvider, getProviders, syncAiceryProviderEnv } from "./llm/config";
import { isStreaming } from "./llm/stream-client";
import { showSettingsPanel } from "./ui/settings-panel";
import { createAgentPanel, type AgentPanel } from "./ui/agent-panel";
import { createPlanPanel, type PlanPanel } from "./ui/agent/plan-panel";
import { cycleModeFromKeyboard } from "./ui/agent/mode-picker";
import { focusChatComposer } from "./ui/task-tracker";
import { createSidebar, type SidebarShell } from "./ui/sidebar";
import type { TaskTrackerHost } from "./ui/task-tracker";
import {
  mountFileTree,
  pickAndOpenWorkspace,
  openWorkspaceByPath,
  renderWelcomePanel,
  restoreLastWorkspace,
} from "./workspace";
import { renderTabBar, TabStore } from "./workspace/tabs";
import type { EditorTab, WorkspaceInfo } from "./workspace/types";
import { initFileWatcher, stopFileWatcher } from "./workspace/watcher";
import { restoreSession } from "./session/restore";
import { initSessionPersistence } from "./session/index";
import { initTelemetry } from "./telemetry";
import {
  getTerminalPanel,
  initTerminal,
  initTerminalErrorFix,
  onWorkspaceOpened as bindTerminalWorkspace,
  setTerminalWorkspaceCwd,
  toggleTerminal,
  unbindTerminalWorkspace,
} from "./terminal";

type AppState = {
  workspace: WorkspaceInfo | null;
  editorView: EditorView | null;
  streaming: boolean;
  diffReview: boolean;
  sidebar: SidebarShell | null;
  agentPanel: AgentPanel | null;
  planPanel: PlanPanel | null;
  fileTree: ReturnType<typeof mountFileTree> | null;
};

const state: AppState = {
  workspace: null,
  editorView: null,
  streaming: false,
  diffReview: false,
  sidebar: null,
  agentPanel: null,
  planPanel: null,
  fileTree: null,
};

const workspaceTitleEl = () =>
  document.querySelector<HTMLElement>("#workspace-title")!;
const statusEl = () => document.querySelector<HTMLElement>("#status-message")!;
const streamCancelBtn = () =>
  document.querySelector<HTMLButtonElement>("#stream-cancel")!;
const agentPanelBtn = () =>
  document.querySelector<HTMLElement>("#btn-agent-panel")!;
const tabBarEl = () => document.querySelector<HTMLElement>("#tab-bar")!;
const sidebarEl = () => document.querySelector<HTMLElement>("#sidebar")!;
const agentPanelEl = () => document.querySelector<HTMLElement>("#agent-panel")!;
const planPanelEl = () => document.querySelector<HTMLElement>("#plan-panel")!;
const planPanelResizerEl = () =>
  document.querySelector<HTMLElement>("#plan-panel-resizer")!;

function taskTrackerHost(): TaskTrackerHost {
  return {
    getEditorView: () => state.editorView,
    getActiveFilePath: () => tabStore.getActiveTab()?.path,
    getWorkspaceRoot: () => state.workspace?.root_path,
    getWorkspaceId: () => state.workspace?.workspace_id,
    openFile: (path, fallbackContent) => openFileInTab(path, fallbackContent),
    onStatus: setStatus,
    showAgentPanel: () => state.agentPanel?.show(),
    onAgentStateChange: (agentState) => {
      state.agentPanel?.setStatus(agentState);
      agentPanelBtn().classList.toggle(
        "agent-active",
        agentState === "running" || agentState === "hitl",
      );
      agentPanelBtn().classList.toggle("agent-hitl", agentState === "hitl");
    },
  };
}

const tabStore = new TabStore({
  onTabsChange: () => {
    renderTabBar(tabBarEl(), tabStore, selectTab, closeTab);
    updateTitlebar();
  },
  onActiveTabChange: (tab) => {
    if (tab) {
      mountEditorFromTab(tab);
    } else {
      destroyEditor();
    }
    refreshCmdKContext();
  },
});

function setStatus(message: string) {
  statusEl().textContent = message;
}

function setStreaming(streaming: boolean) {
  state.streaming = streaming;
  const btn = streamCancelBtn();
  const statusbar = document.querySelector(".statusbar");
  if (streaming) {
    btn.hidden = false;
    statusbar?.classList.add("streaming");
    pauseAutocomplete(state.editorView);
  } else {
    btn.hidden = true;
    statusbar?.classList.remove("streaming");
    if (!state.diffReview) {
      resumeAutocomplete(state.editorView);
    }
  }
}

function updateTitlebar() {
  const ws = state.workspace;
  const tab = tabStore.getActiveTab();
  const el = workspaceTitleEl();
  el.replaceChildren();

  if (ws && tab) {
    el.append(document.createTextNode(ws.name));
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "›";
    el.append(sep, document.createTextNode(`${tab.name}${tab.dirty ? " *" : ""}`));
  } else if (ws) {
    el.textContent = ws.name;
  } else if (tab) {
    el.textContent = `${tab.name}${tab.dirty ? " *" : ""}`;
  } else {
    el.textContent = "No folder open";
  }
}

function setDiffReview(active: boolean, summary?: DiffReviewSummary | null) {
  state.diffReview = active;
  updateDiffToolbar(active, summary ?? null);
  if (active) {
    pauseAutocomplete(state.editorView);
  } else if (!state.streaming) {
    resumeAutocomplete(state.editorView);
  }
}

function pathsEquivalent(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  return a.split(/[/\\]/).pop() === b.split(/[/\\]/).pop();
}

async function applyPatchToEditor(newContent: string, filePath: string) {
  const tab = tabStore.getActiveTab();
  if (!tab || !pathsEquivalent(tab.path, filePath)) {
    return;
  }

  try {
    await invoke("write_file", { path: tab.path, content: newContent });
  } catch (err) {
    setStatus(`Save after apply failed: ${String(err)}`);
  }

  tabStore.updateActiveContent(newContent, false);
  if (state.editorView) {
    state.editorView.dispatch({
      changes: {
        from: 0,
        to: state.editorView.state.doc.length,
        insert: newContent,
      },
    });
  }
  updateTitlebar();
  setDiffReview(false);
}

function refreshCmdKContext() {
  const tab = tabStore.getActiveTab();
  initCmdKContext({
    filePath: tab?.path ?? "untitled",
    workspaceRoot: state.workspace?.root_path,
    onStatus: setStatus,
    onStreamingChange: setStreaming,
    onDiffReviewChange: (summary) => {
      setDiffReview(summary !== null, summary);
    },
    onApplyPatch: (newContent, filePath) => {
      applyPatchToEditor(newContent, filePath);
    },
  });
}

function destroyEditor() {
  state.editorView?.destroy();
  state.editorView = null;
  const container = document.querySelector<HTMLElement>("#editor")!;
  container.innerHTML = "";
}

function mountEditorFromTab(tab: EditorTab) {
  const container = document.querySelector<HTMLElement>("#editor")!;
  container.innerHTML = "";

  state.editorView?.destroy();
  state.editorView = createEditor(container, {
    doc: tab.content,
    path: tab.path,
    onChange: () => {
      if (!state.editorView) {
        return;
      }
      tabStore.updateActiveContent(
        state.editorView.state.doc.toString(),
        true,
      );
      updateTitlebar();
    },
    mode: state.streaming ? "cmdk" : "default",
    extensions: [
      autocompleteControllerExtension(() => tabStore.getActiveTab()?.path ?? tab.path),
    ],
  });
  void refreshAutocompleteConfig();
  updateTitlebar();
}

function persistActiveTabContent() {
  const tab = tabStore.getActiveTab();
  if (!tab || !state.editorView) {
    return;
  }
  tab.content = state.editorView.state.doc.toString();
}

async function openFileInTab(path: string, fallbackContent?: string) {
  let content: string;
  try {
    content = await invoke<string>("read_file", { path });
  } catch {
    if (fallbackContent === undefined) {
      throw new Error(`Could not read file: ${path}`);
    }
    content = fallbackContent;
  }
  const existing = tabStore.findByPath(path);
  const activeTab = tabStore.getActiveTab();
  const keepEditor =
    Boolean(
      existing &&
        activeTab?.path === path &&
        state.editorView &&
        isDiffReviewActive(state.editorView),
    );

  if (existing) {
    if (keepEditor) {
      setStatus(`Reviewing ${path}`);
      return;
    }
    tabStore.reloadTabContent(path, content);
    tabStore.setActive(existing.id);
  } else {
    tabStore.openTab(path, content);
  }
  setStatus(`Opened ${path}`);
}

function selectTab(id: string) {
  persistActiveTabContent();
  tabStore.setActive(id);
}

function closeTab(id: string) {
  const wasActive = tabStore.getActiveId() === id;
  if (!tabStore.closeTab(id)) {
    return;
  }
  if (wasActive) {
    const tab = tabStore.getActiveTab();
    if (tab) {
      mountEditorFromTab(tab);
    } else {
      destroyEditor();
    }
  }
  setStatus("Tab closed");
}

async function saveActiveFile() {
  const tab = tabStore.getActiveTab();
  if (!tab || !state.editorView) {
    setStatus("No file open to save");
    return;
  }

  try {
    const content = state.editorView.state.doc.toString();
    await invoke("write_file", { path: tab.path, content });
    tabStore.updateActiveContent(content, false);
    updateTitlebar();
    setStatus(`Saved ${tab.path}`);
  } catch (err) {
    setStatus(`Save failed: ${String(err)}`);
    console.error("Save failed:", err);
  }
}

const workspaceUi = {
  get sidebarEl() {
    return sidebarEl();
  },
  onWorkspaceOpened: (info: WorkspaceInfo) => {
    void (async () => {
      if (state.workspace?.workspace_id) {
        await flushSave();
      }
      state.workspace = info;
      if (!state.sidebar) {
        state.sidebar = createSidebar(sidebarEl());
      }
      state.fileTree = state.sidebar.mountTree(info.root_path, {
        onFileClick: (path) => {
          void openFileInTab(path);
        },
        onFileDeleted: (path) => {
          tabStore.closeTabByPath(path, true);
          if (tabStore.getActiveTab()?.path === path) {
            destroyEditor();
          }
          updateTitlebar();
        },
        onFileRenamed: (oldPath, newPath) => {
          tabStore.renameTabPath(oldPath, newPath);
          updateTitlebar();
        },
      });
      await state.fileTree.refreshWorkspace();
      void bindTerminalWorkspace(info.root_path);
      await initChatSessionsForWorkspace(info.workspace_id);
      void restoreLatestPlanForWorkspace();
      void refreshMaxParallelRunsFromSettings();
      updateTitlebar();
      refreshCmdKContext();
      setStatus(`Opened workspace ${info.name}`);
    })();
  },
  onWorkspaceClosed: () => {
    void stopFileWatcher();
    state.workspace = null;
    setTerminalWorkspaceCwd(null);
    void unbindTerminalWorkspace();
    state.fileTree?.clear();
    state.fileTree = null;
    if (state.sidebar) {
      state.sidebar.clear();
      renderWelcomePanel(
        state.sidebar.getFilesPanel(),
        () => void pickAndOpenWorkspace(workspaceUi),
        (path) => void openWorkspaceByPath(path, workspaceUi),
      );
    }
    updateTitlebar();
  },
  onOpenFolder: () => {},
};

async function maybePromptForLlmConfig() {
  try {
    const [providers, active] = await Promise.all([
      getProviders(),
      getActiveProvider(),
    ]);
    const info = providers.find((p) => p.id === active.provider_id);
    if (info?.requires_api_key && !active.has_api_key) {
      await showSettingsPanel(
        `Enter your ${info.name} API key to use Cmd+K.`,
      );
    }
  } catch (err) {
    setStatus(`Config error: ${String(err)}`);
  }
}

function isModKey(event: KeyboardEvent): boolean {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return isMac ? event.metaKey : event.ctrlKey;
}

function bindShortcuts() {
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        const panel = agentPanelEl();
        if (state.agentPanel?.isOpen() && panel.contains(document.activeElement)) {
          state.agentPanel.toggleHistory();
          event.preventDefault();
        }
        return;
      }

      if (event.key === "Tab" && event.shiftKey) {
        const panel = agentPanelEl();
        if (!state.agentPanel?.isOpen()) {
          return;
        }
        const active = document.activeElement;
        if (
          active instanceof HTMLTextAreaElement &&
          active.classList.contains("chat-composer-input")
        ) {
          return;
        }
        if (!panel.contains(active) && active !== document.body) {
          return;
        }
        event.preventDefault();
        void cycleModeFromKeyboard(setStatus);
        return;
      }

      if (event.ctrlKey && event.key === "`") {
        event.preventDefault();
        event.stopPropagation();
        void toggleTerminal();
        return;
      }

      if (!isModKey(event)) {
        if (event.key.toLowerCase() === "z" && event.shiftKey === false && (event.ctrlKey || event.metaKey)) {
          const panel = agentPanelEl();
          if (state.agentPanel?.isOpen() && panel.contains(document.activeElement)) {
            event.preventDefault();
            void state.agentPanel.undoCloseChatTab();
          }
        }
        return;
      }

      const key = event.key.toLowerCase();
      const panelFocused =
        state.agentPanel?.isOpen() &&
        agentPanelEl().contains(document.activeElement);

      if (key === "s") {
        event.preventDefault();
        void saveActiveFile();
      } else if (key === "w") {
        event.preventDefault();
        if (panelFocused) {
          void state.agentPanel?.closeActiveChatTab();
        } else {
          tabStore.closeActiveTab();
        }
      } else if (key === "i" && event.shiftKey) {
        event.preventDefault();
        state.agentPanel?.show();
        void state.agentPanel?.createNewChatTab();
        focusChatComposer();
      } else if (key === "i") {
        event.preventDefault();
        state.agentPanel?.show();
        focusChatComposer();
      }
    },
    true,
  );
}

function syncAgentPanelButton(open: boolean): void {
  agentPanelBtn().classList.toggle("open", open);
}

function bindUi() {
  document.querySelector("#btn-agent-panel")?.addEventListener("click", () => {
    state.agentPanel?.toggle();
  });
  document.querySelector("#btn-open-folder")?.addEventListener("click", () => {
    void pickAndOpenWorkspace(workspaceUi).catch((err) => {
      setStatus(`Open folder failed: ${String(err)}`);
    });
  });
  document.querySelector("#btn-save")?.addEventListener("click", () => {
    void saveActiveFile();
  });
  document.querySelector("#btn-settings")?.addEventListener("click", () => {
    void showSettingsPanel(undefined, {
      workspaceId: state.workspace?.workspace_id,
      onOpenFile: (path) => openFileInTab(path),
    });
  });
  streamCancelBtn()?.addEventListener("click", () => {
    if (state.editorView && isStreaming()) {
      void cancelActiveStream(state.editorView);
    }
  });
  bindDiffToolbar({
    getEditorView: () => state.editorView,
  });
}

export async function initApp() {
  initTelemetry();
  void syncAiceryProviderEnv().catch(() => {});
  bindUi();
  bindShortcuts();
  refreshCmdKContext();
  updateTitlebar();
  setStreaming(false);

  initTerminal();
  initTerminalErrorFix({
    ...taskTrackerHost(),
    getSessionId: () => getTerminalPanel()?.sessionId ?? null,
    onStatus: setStatus,
    openFile: (path, fallbackContent) => openFileInTab(path, fallbackContent),
  });

  state.sidebar = createSidebar(sidebarEl());
  state.agentPanel = createAgentPanel(
    agentPanelEl(),
    taskTrackerHost(),
    syncAgentPanelButton,
  );
  state.planPanel = createPlanPanel(
    planPanelEl(),
    planPanelResizerEl(),
    taskTrackerHost(),
  );
  syncAgentPanelButton(state.agentPanel.isOpen());

  renderWelcomePanel(
    state.sidebar.getFilesPanel(),
    () => void pickAndOpenWorkspace(workspaceUi),
    (path) => void openWorkspaceByPath(path, workspaceUi),
  );

  await initFileWatcher(
    tabStore,
    {
      onStatus: setStatus,
      reloadEditor: (path, content) => {
        const tab = tabStore.getActiveTab();
        if (tab?.path === path && state.editorView) {
          mountEditorFromTab({ ...tab, content, dirty: false });
        }
      },
      isActivePath: (path) => tabStore.getActiveTab()?.path === path,
      isPathDirty: (path) => tabStore.findByPath(path)?.dirty ?? false,
    },
    () => state.fileTree,
  );

  await restoreLastWorkspace(workspaceUi);
  initSessionPersistence();
  if (state.workspace?.workspace_id) {
    await restoreSession(state.workspace.workspace_id, (runId, status) => {
      setStatus(`Previous agent run (${status}): ${runId.slice(0, 8)}… — open Tasks to resume`);
    });
  }
  await maybePromptForLlmConfig();
}
