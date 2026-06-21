import { mountFileTree } from "../workspace";
import type { FileTree, FileTreeCallbacks } from "../workspace/file-tree";

export type SidebarShell = {
  getFilesPanel: () => HTMLElement;
  mountTree: (rootPath: string, callbacks: FileTreeCallbacks) => FileTree;
  clear: () => void;
};

export function createSidebar(sidebarEl: HTMLElement): SidebarShell {
  const filesPanel = document.createElement("div");
  filesPanel.className = "sidebar-panel";
  filesPanel.id = "sidebar-files-panel";

  sidebarEl.innerHTML = "";
  sidebarEl.append(filesPanel);

  let fileTree: FileTree | null = null;

  return {
    getFilesPanel: () => filesPanel,
    mountTree(rootPath, callbacks) {
      fileTree = mountFileTree(filesPanel, rootPath, callbacks);
      return fileTree;
    },
    clear() {
      filesPanel.innerHTML = "";
      fileTree = null;
    },
  };
}
