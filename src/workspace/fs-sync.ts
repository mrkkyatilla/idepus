import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

import type { FileTree } from "./file-tree";
import { parentDir } from "./fs";
import type { TabStore } from "./tabs";
import type { FileChangeEvent } from "./types";

export type FsSyncCallbacks = {
  onStatus: (message: string) => void;
  reloadEditor: (path: string, content: string) => void;
  isActivePath: (path: string) => boolean;
  isPathDirty: (path: string) => boolean;
};

let unlistenFile: UnlistenFn | null = null;
let unlistenFocus: UnlistenFn | null = null;
let visibilityHandler: (() => void) | null = null;
let focusTimer: ReturnType<typeof setTimeout> | null = null;

export async function initFsSync(options: {
  tabStore: TabStore;
  getFileTree: () => FileTree | null;
  callbacks: FsSyncCallbacks;
}): Promise<void> {
  await teardownFsSync();

  unlistenFile = await listen<FileChangeEvent>("file_changed", (event) => {
    void handleFileChange(event.payload, options);
  });

  const win = getCurrentWindow();
  unlistenFocus = await win.listen("tauri://focus", () => {
    scheduleFocusRefresh(options);
  });

  visibilityHandler = () => {
    if (document.visibilityState === "visible") {
      scheduleFocusRefresh(options);
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", visibilityHandler);
  }
}

export async function teardownFsSync(): Promise<void> {
  if (unlistenFile) {
    unlistenFile();
    unlistenFile = null;
  }
  if (unlistenFocus) {
    unlistenFocus();
    unlistenFocus = null;
  }
  if (visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  if (focusTimer) {
    clearTimeout(focusTimer);
    focusTimer = null;
  }
}

function scheduleFocusRefresh(options: {
  getFileTree: () => FileTree | null;
}): void {
  if (focusTimer) {
    clearTimeout(focusTimer);
  }
  focusTimer = setTimeout(() => {
    focusTimer = null;
    void options.getFileTree()?.refreshWorkspace();
  }, 400);
}

async function handleFileChange(
  event: FileChangeEvent,
  options: {
    tabStore: TabStore;
    getFileTree: () => FileTree | null;
    callbacks: FsSyncCallbacks;
  },
): Promise<void> {
  const tree = options.getFileTree();
  const { tabStore, callbacks } = options;
  const { path, kind, old_path: oldPath } = event;

  switch (kind) {
    case "created":
      if (tree) {
        await tree.refreshPath(parentDir(path));
      }
      return;
    case "deleted": {
      tree?.removeNode(path);
      const tab = tabStore.findByPath(path);
      if (tab) {
        const closed = tabStore.closeTabByPath(path, true);
        if (closed) {
          callbacks.onStatus(`Closed deleted file: ${tab.name}`);
        }
      }
      return;
    }
    case "renamed": {
      if (oldPath && tree) {
        await tree.handleRename(oldPath, path);
      }
      if (oldPath) {
        tabStore.renameTabPath(oldPath, path);
      }
      await reloadTabIfOpen(path, tabStore, callbacks);
      return;
    }
    case "modified":
      await reloadTabIfOpen(path, tabStore, callbacks);
      return;
  }
}

async function reloadTabIfOpen(
  path: string,
  store: TabStore,
  callbacks: FsSyncCallbacks,
): Promise<void> {
  const tab = store.findByPath(path);
  if (!tab) {
    return;
  }

  if (!callbacks.isActivePath(path) && !tab.dirty) {
    try {
      const content = await invoke<string>("read_file", { path });
      store.reloadTabContent(path, content);
    } catch {
      // ignore
    }
    return;
  }

  if (!callbacks.isActivePath(path)) {
    return;
  }

  if (callbacks.isPathDirty(path)) {
    showConflictModal(path, store, callbacks);
    return;
  }

  try {
    const content = await invoke<string>("read_file", { path });
    store.reloadTabContent(path, content);
    callbacks.reloadEditor(path, content);
    callbacks.onStatus(`Reloaded ${tab.name} (external change)`);
  } catch (err) {
    callbacks.onStatus(`Failed to reload: ${String(err)}`);
  }
}

function showConflictModal(
  path: string,
  store: TabStore,
  callbacks: FsSyncCallbacks,
): void {
  const existing = document.getElementById("conflict-modal");
  existing?.remove();

  const tab = store.findByPath(path);
  const name = tab?.name ?? path;

  const overlay = document.createElement("div");
  overlay.id = "conflict-modal";
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal conflict-modal";

  const title = document.createElement("h2");
  title.textContent = "File changed externally";
  modal.appendChild(title);

  const text = document.createElement("p");
  text.className = "modal-hint";
  text.textContent = `"${name}" was modified outside idepus. Reload and discard your local edits?`;
  modal.appendChild(text);

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const keepBtn = document.createElement("button");
  keepBtn.type = "button";
  keepBtn.textContent = "Keep local";
  keepBtn.addEventListener("click", () => {
    overlay.remove();
    callbacks.onStatus("Kept local changes");
  });

  const reloadBtn = document.createElement("button");
  reloadBtn.type = "button";
  reloadBtn.textContent = "Reload";
  reloadBtn.addEventListener("click", async () => {
    try {
      const content = await invoke<string>("read_file", { path });
      store.reloadTabContent(path, content);
      callbacks.reloadEditor(path, content);
      callbacks.onStatus(`Reloaded ${name}`);
    } catch (err) {
      callbacks.onStatus(`Failed to reload: ${String(err)}`);
    }
    overlay.remove();
  });

  actions.append(keepBtn, reloadBtn);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
