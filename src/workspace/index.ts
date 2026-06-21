import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { FileTree, type FileTreeCallbacks } from "./file-tree";
import { createDir, createFile, joinPath } from "./fs";
import { promptInput } from "../ui/context-menu";
import type { RecentWorkspace, WorkspaceInfo } from "./types";

const LAST_WORKSPACE_KEY = "idepus:lastWorkspace";

export type WorkspaceUi = {
  sidebarEl: HTMLElement;
  onWorkspaceOpened: (info: WorkspaceInfo) => void;
  onWorkspaceClosed: () => void;
  onOpenFolder: () => void;
};

export async function openWorkspaceByPath(
  path: string,
  ui: WorkspaceUi,
): Promise<WorkspaceInfo> {
  const info = await invoke<WorkspaceInfo>("open_workspace", { path });
  localStorage.setItem(LAST_WORKSPACE_KEY, info.root_path);
  ui.onWorkspaceOpened(info);
  return info;
}

export async function pickAndOpenWorkspace(ui: WorkspaceUi): Promise<void> {
  try {
    const path = await open({
      directory: true,
      multiple: false,
      title: "Open project folder",
    });
    if (typeof path === "string") {
      await openWorkspaceByPath(path, ui);
    }
  } catch (err) {
    console.error("Open folder failed:", err);
    throw err;
  }
}

export async function restoreLastWorkspace(ui: WorkspaceUi): Promise<void> {
  const last = localStorage.getItem(LAST_WORKSPACE_KEY);
  if (!last) {
    return;
  }

  try {
    await openWorkspaceByPath(last, ui);
  } catch (err) {
    localStorage.removeItem(LAST_WORKSPACE_KEY);
    console.warn("Could not restore workspace:", err);
  }
}

export function renderWelcomePanel(
  sidebarEl: HTMLElement,
  onOpenFolder: () => void,
  onOpenRecent: (path: string) => void,
): void {
  sidebarEl.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "welcome-panel";

  const label = document.createElement("p");
  label.className = "sidebar-label";
  label.textContent = "Explorer";
  panel.appendChild(label);

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "btn btn-secondary welcome-open-btn";
  openBtn.textContent = "Open Folder";
  openBtn.addEventListener("click", onOpenFolder);
  panel.appendChild(openBtn);

  const recentTitle = document.createElement("p");
  recentTitle.className = "recent-title";
  recentTitle.textContent = "Recent projects";
  panel.appendChild(recentTitle);

  const list = document.createElement("ul");
  list.className = "recent-list";
  panel.appendChild(list);

  void loadRecentList(list, onOpenRecent);
  sidebarEl.appendChild(panel);
}

async function loadRecentList(
  list: HTMLUListElement,
  onOpenRecent: (path: string) => void,
): Promise<void> {
  try {
    const recent = await invoke<RecentWorkspace[]>("get_recent_workspaces");
    list.innerHTML = "";
    if (recent.length === 0) {
      const empty = document.createElement("li");
      empty.className = "recent-empty";
      empty.textContent = "No recent projects";
      list.appendChild(empty);
      return;
    }

    for (const item of recent) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "recent-item";
      btn.title = item.path;
      btn.textContent = item.name;
      btn.addEventListener("click", () => onOpenRecent(item.path));
      li.appendChild(btn);
      list.appendChild(li);
    }
  } catch {
    list.innerHTML = "<li class='recent-empty'>Could not load recent</li>";
  }
}

export function mountFileTree(
  sidebarEl: HTMLElement,
  rootPath: string,
  callbacks: FileTreeCallbacks,
): FileTree {
  sidebarEl.innerHTML = "";

  const headerRow = document.createElement("div");
  headerRow.className = "file-tree-header";

  const header = document.createElement("p");
  header.className = "sidebar-label";
  header.textContent = "Explorer";
  headerRow.appendChild(header);

  const actions = document.createElement("div");
  actions.className = "file-tree-actions";

  const treeHost = document.createElement("div");
  treeHost.className = "file-tree-host";

  const tree = new FileTree(treeHost, callbacks);

  const newFileBtn = document.createElement("button");
  newFileBtn.type = "button";
  newFileBtn.className = "btn btn-ghost btn-sm file-tree-action";
  newFileBtn.title = "New File";
  newFileBtn.textContent = "+F";
  newFileBtn.addEventListener("click", () => {
    void (async () => {
      const base = tree.getCreateBaseDir();
      const name = promptInput("New file name");
      if (!name) {
        return;
      }
      const path = joinPath(base, name);
      await createFile(path, "");
      await tree.refreshPath(base);
      tree.selectPath(path);
      callbacks.onFileClick(path);
      callbacks.onFileCreated?.(path);
    })();
  });

  const newFolderBtn = document.createElement("button");
  newFolderBtn.type = "button";
  newFolderBtn.className = "btn btn-ghost btn-sm file-tree-action";
  newFolderBtn.title = "New Folder";
  newFolderBtn.textContent = "+D";
  newFolderBtn.addEventListener("click", () => {
    void (async () => {
      const base = tree.getCreateBaseDir();
      const name = promptInput("New folder name");
      if (!name) {
        return;
      }
      await createDir(joinPath(base, name));
      await tree.refreshPath(base);
    })();
  });

  actions.append(newFileBtn, newFolderBtn);
  headerRow.appendChild(actions);
  sidebarEl.appendChild(headerRow);
  sidebarEl.appendChild(treeHost);

  void tree.setWorkspace(rootPath);
  return tree;
}
