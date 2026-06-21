import { getActiveRunId } from "../../agent/client";
import {
  closeSession,
  createSession,
  getActiveSessionId,
  getOpenSessionSummaries,
  getOpenTabCount,
  renameSession,
  restoreClosedSession,
  subscribeChatSessions,
  switchSession,
} from "../../chat/session-store";
import { MAX_OPEN_TABS } from "../../chat/session-types";
import type { ChatSession } from "../../chat/session-types";

export type ChatTabsMount = {
  destroy: () => void;
  createNewTab: () => Promise<void>;
  closeActiveTab: () => Promise<void>;
  undoClose: () => Promise<boolean>;
};

export function mountChatTabs(
  hostEl: HTMLElement,
  options: {
    onStatus: (message: string) => void;
    canSwitch: () => boolean;
  },
): ChatTabsMount {
  const root = document.createElement("div");
  root.className = "chat-tabs";

  const list = document.createElement("div");
  list.className = "chat-tabs-list";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn-ghost btn-icon chat-tabs-add";
  addBtn.title = `New chat (⌘⇧I) — ${MAX_OPEN_TABS} tabs max`;
  addBtn.textContent = "+";

  root.append(list, addBtn);
  hostEl.appendChild(root);

  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRestore: ChatSession | null = null;

  function render(): void {
    list.innerHTML = "";
    const summaries = getOpenSessionSummaries();
    const current = getActiveSessionId();

    for (const tab of summaries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `chat-tab chat-tab--${tab.mode}`;
      if (tab.id === current) {
        btn.classList.add("chat-tab--active");
      }
      btn.title = tab.title;

      const label = document.createElement("span");
      label.className = "chat-tab-label";
      label.textContent = tab.title;
      btn.appendChild(label);

      if (summaries.length > 1) {
        const close = document.createElement("span");
        close.className = "chat-tab-close";
        close.textContent = "×";
        close.addEventListener("click", (event) => {
          event.stopPropagation();
          void closeTab(tab.id);
        });
        btn.appendChild(close);
      }

      btn.addEventListener("click", () => {
        if (!options.canSwitch()) {
          options.onStatus("Finish or cancel the active agent run first");
          return;
        }
        void switchSession(tab.id);
      });

      btn.addEventListener("dblclick", (event) => {
        event.preventDefault();
        startRename(tab.id, label);
      });

      list.appendChild(btn);
    }
  }

  function startRename(sessionId: string, labelEl: HTMLElement): void {
    const input = document.createElement("input");
    input.className = "chat-tab-rename";
    input.value = labelEl.textContent ?? "";
    labelEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      void renameSession(sessionId, input.value);
      render();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
      if (event.key === "Escape") {
        render();
      }
    });
  }

  async function closeTab(sessionId: string): Promise<void> {
    if (getActiveRunId()) {
      options.onStatus("Cancel the active run before closing this tab");
      return;
    }
    const removed = await closeSession(sessionId);
    if (!removed) {
      return;
    }
    if (undoTimer) {
      clearTimeout(undoTimer);
    }
    pendingRestore = removed;
    options.onStatus("Chat closed — press ⌘Z within 5s to undo");
    undoTimer = setTimeout(() => {
      pendingRestore = null;
      undoTimer = null;
    }, 5000);
  }

  async function createNewTab(): Promise<void> {
    if (getOpenTabCount() >= MAX_OPEN_TABS) {
      options.onStatus(`Maximum ${MAX_OPEN_TABS} chat tabs open — close one first`);
      return;
    }
    try {
      await createSession();
      options.onStatus("New chat");
    } catch (err) {
      options.onStatus(String(err));
    }
  }

  async function undoClose(): Promise<boolean> {
    if (!pendingRestore) {
      return false;
    }
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    const session = pendingRestore;
    pendingRestore = null;
    await restoreClosedSession(session);
    options.onStatus("Chat restored");
    return true;
  }

  addBtn.addEventListener("click", () => {
    void createNewTab();
  });

  const unsubscribe = subscribeChatSessions(render);
  render();

  async function closeActiveTab(): Promise<void> {
    const current = getActiveSessionId();
    if (current) {
      await closeTab(current);
    }
  }

  return {
    destroy() {
      unsubscribe();
      if (undoTimer) {
        clearTimeout(undoTimer);
      }
      root.remove();
    },
    createNewTab,
    closeActiveTab,
    undoClose,
  };
}
