import type { TabStore } from "./tabs";
import type { FileTree } from "./file-tree";

export type WatcherCallbacks = {
  onStatus: (message: string) => void;
  reloadEditor: (path: string, content: string) => void;
  isActivePath: (path: string) => boolean;
  isPathDirty: (path: string) => boolean;
};

let initialized = false;

export async function initFileWatcher(
  store: TabStore,
  callbacks: WatcherCallbacks,
  getFileTree: () => FileTree | null,
): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;
  const { initFsSync } = await import("./fs-sync");
  await initFsSync({
    tabStore: store,
    getFileTree,
    callbacks,
  });
}

export async function stopFileWatcher(): Promise<void> {
  if (!initialized) {
    return;
  }
  initialized = false;
  const { teardownFsSync } = await import("./fs-sync");
  await teardownFsSync();
}
