import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";

import {
  confirmAction,
  copyTextToClipboard,
  promptInput,
  showContextMenu,
} from "../ui/context-menu";
import {
  createDir,
  createFile,
  deletePath,
  joinPath,
  parentDir,
  renamePath,
} from "./fs";
import type { FileEntry } from "./types";
import { IDEPUS_PATH_MIME, relWorkspacePath } from "../context/mention-autocomplete";

const ROW_HEIGHT = 24;

export type TreeNode = {
  entry: FileEntry;
  depth: number;
  expanded: boolean;
  loaded: boolean;
  children: TreeNode[];
};

export type FileTreeCallbacks = {
  onFileClick: (path: string) => void;
  onFileCreated?: (path: string) => void;
  onFileDeleted?: (path: string) => void;
  onFileRenamed?: (oldPath: string, newPath: string) => void;
};

export class FileTree {
  private rootPath = "";
  private nodes: TreeNode[] = [];
  private flatRows: TreeNode[] = [];
  private scrollTop = 0;
  private viewportHeight = 400;
  private container: HTMLElement;
  private scrollEl: HTMLElement;
  private callbacks: FileTreeCallbacks;
  private selectedPath: string | null = null;

  constructor(container: HTMLElement, callbacks: FileTreeCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.scrollEl = document.createElement("div");
    this.scrollEl.className = "file-tree-scroll";
    this.container.innerHTML = "";
    this.container.appendChild(this.scrollEl);

    this.scrollEl.addEventListener("scroll", () => {
      this.scrollTop = this.scrollEl.scrollTop;
      this.renderViewport();
    });

    this.scrollEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.showBackgroundMenu(event, this.rootPath);
    });

    const observer = new ResizeObserver(() => {
      this.viewportHeight = this.scrollEl.clientHeight || 400;
      this.renderViewport();
    });
    observer.observe(this.scrollEl);

    document.addEventListener("keydown", (event) => {
      if (!this.selectedPath) {
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        void this.renameSelected();
      }
      if (event.key === "Delete") {
        event.preventDefault();
        void this.deleteSelected();
      }
    });
  }

  getRootPath(): string {
    return this.rootPath;
  }

  getSelectedPath(): string | null {
    return this.selectedPath;
  }

  async setWorkspace(rootPath: string): Promise<void> {
    this.rootPath = rootPath;
    await this.loadRoot();
  }

  async refreshWorkspace(): Promise<void> {
    if (!this.rootPath) {
      return;
    }
    await this.loadRoot();
    const expanded = this.collectExpandedDirs();
    for (const dir of expanded) {
      await this.refreshPath(dir);
    }
  }

  async refreshPath(dirPath: string): Promise<void> {
    const node = this.findNode(dirPath);
    if (!node?.entry.is_dir) {
      const parent = parentDir(dirPath);
      if (parent && parent !== dirPath) {
        await this.refreshPath(parent);
      }
      return;
    }
    const entries = await invoke<FileEntry[]>("list_dir", {
      path: dirPath,
      recursive: false,
    });
    node.children = entries.map((entry) => ({
      entry,
      depth: node.depth + 1,
      expanded: false,
      loaded: false,
      children: [],
    }));
    node.loaded = true;
    node.expanded = true;
    this.rebuildFlat();
    this.renderViewport();
  }

  removeNode(path: string): void {
    const parentPath = parentDir(path);
    const parent =
      parentPath === path ? null : this.findNode(parentPath);
    if (parent) {
      parent.children = parent.children.filter((c) => c.entry.path !== path);
      this.rebuildFlat();
      this.renderViewport();
      return;
    }
    this.nodes = this.nodes.filter((n) => n.entry.path !== path);
    if (this.selectedPath === path) {
      this.selectedPath = null;
    }
    this.rebuildFlat();
    this.renderViewport();
  }

  async handleRename(oldPath: string, newPath: string): Promise<void> {
    const node = this.findNode(oldPath);
    if (!node) {
      await this.refreshPath(parentDir(newPath));
      return;
    }
    node.entry.path = newPath;
    node.entry.name = newPath.split(/[/\\]/).pop() ?? newPath;
    const oldParent = parentDir(oldPath);
    const newParent = parentDir(newPath);
    if (oldParent !== newParent) {
      this.removeNode(oldPath);
      await this.refreshPath(newParent);
    } else {
      this.rebuildFlat();
      this.renderViewport();
    }
    if (this.selectedPath === oldPath) {
      this.selectedPath = newPath;
    }
  }

  selectPath(path: string | null): void {
    this.selectedPath = path;
    this.renderViewport();
  }

  getCreateBaseDir(): string {
    if (!this.selectedPath) {
      return this.rootPath;
    }
    const node = this.findNode(this.selectedPath);
    if (node?.entry.is_dir) {
      return node.entry.path;
    }
    return parentDir(this.selectedPath);
  }

  clear(): void {
    this.rootPath = "";
    this.nodes = [];
    this.flatRows = [];
    this.selectedPath = null;
    this.scrollEl.innerHTML = "";
  }

  private async loadRoot(): Promise<void> {
    const entries = await invoke<FileEntry[]>("list_dir", {
      path: this.rootPath,
      recursive: false,
    });
    this.nodes = entries.map((entry) => ({
      entry,
      depth: 0,
      expanded: false,
      loaded: false,
      children: [],
    }));
    this.rebuildFlat();
    this.renderViewport();
  }

  private collectExpandedDirs(): string[] {
    const dirs: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.entry.is_dir && node.expanded) {
          dirs.push(node.entry.path);
          walk(node.children);
        }
      }
    };
    walk(this.nodes);
    return dirs;
  }

  private findNode(path: string): TreeNode | null {
    const walk = (nodes: TreeNode[]): TreeNode | null => {
      for (const node of nodes) {
        if (node.entry.path === path) {
          return node;
        }
        const found = walk(node.children);
        if (found) {
          return found;
        }
      }
      return null;
    };
    return walk(this.nodes);
  }

  private rebuildFlat(): void {
    const rows: TreeNode[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        rows.push(node);
        if (node.expanded && node.children.length > 0) {
          walk(node.children);
        }
      }
    };
    walk(this.nodes);
    this.flatRows = rows;
  }

  private async toggleNode(node: TreeNode): Promise<void> {
    this.selectPath(node.entry.path);
    if (!node.entry.is_dir) {
      this.callbacks.onFileClick(node.entry.path);
      return;
    }

    if (!node.expanded) {
      if (!node.loaded) {
        await this.refreshPath(node.entry.path);
        return;
      }
      node.expanded = true;
    } else {
      node.expanded = false;
    }

    this.rebuildFlat();
    this.renderViewport();
  }

  private renderViewport(): void {
    const totalHeight = this.flatRows.length * ROW_HEIGHT;
    const startIdx = Math.floor(this.scrollTop / ROW_HEIGHT);
    const visibleCount = Math.ceil(this.viewportHeight / ROW_HEIGHT) + 2;
    const endIdx = Math.min(startIdx + visibleCount, this.flatRows.length);

    const inner = document.createElement("div");
    inner.className = "file-tree-inner";
    inner.style.height = `${totalHeight}px`;

    const slice = document.createElement("div");
    slice.className = "file-tree-slice";
    slice.style.transform = `translateY(${startIdx * ROW_HEIGHT}px)`;

    for (let i = startIdx; i < endIdx; i++) {
      const node = this.flatRows[i];
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tree-row";
      if (node.entry.is_dir) {
        row.classList.add("tree-row--dir");
      }
      if (node.entry.path === this.selectedPath) {
        row.classList.add("tree-row--selected");
      }
      row.style.paddingLeft = `${8 + node.depth * 14}px`;

      const chevron = document.createElement("span");
      chevron.className = "tree-chevron";
      chevron.textContent = node.entry.is_dir
        ? node.expanded
          ? "▼"
          : "▶"
        : " ";
      row.appendChild(chevron);

      const icon = renderTreeIcon(
        node.entry.name,
        node.entry.is_dir,
        node.expanded,
      );
      row.appendChild(icon);

      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent = node.entry.name;
      row.appendChild(label);

      row.addEventListener("click", () => {
        void this.toggleNode(node);
      });

      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.selectPath(node.entry.path);
        this.showEntryMenu(event, node);
      });

      row.draggable = true;
      row.addEventListener("dragstart", (event) => {
        const rel = relWorkspacePath(node.entry.path, this.rootPath) ?? node.entry.path;
        const payload = {
          kind: node.entry.is_dir ? "folder" : "file",
          absPath: node.entry.path,
          relPath: rel,
          name: node.entry.name,
        };
        event.dataTransfer?.setData(
          IDEPUS_PATH_MIME,
          JSON.stringify(payload),
        );
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "copy";
        }
        row.classList.add("tree-row--dragging");
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("tree-row--dragging");
      });

      slice.appendChild(row);
    }

    inner.appendChild(slice);
    this.scrollEl.innerHTML = "";
    this.scrollEl.appendChild(inner);
  }

  private showBackgroundMenu(event: MouseEvent, baseDir: string): void {
    showContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { id: "new-file", label: "New File…" },
        { id: "new-folder", label: "New Folder…" },
      ],
      onSelect: (id) => {
        if (id === "new-file") {
          void this.createNewFile(baseDir);
        } else if (id === "new-folder") {
          void this.createNewFolder(baseDir);
        }
      },
    });
  }

  private showEntryMenu(event: MouseEvent, node: TreeNode): void {
    const path = node.entry.path;
    const isDir = node.entry.is_dir;
    showContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { id: "new-file", label: "New File…", disabled: !isDir },
        { id: "new-folder", label: "New Folder…", disabled: !isDir },
        { id: "sep1", label: "", separator: true },
        { id: "rename", label: "Rename" },
        { id: "delete", label: "Delete", danger: true },
        { id: "sep2", label: "", separator: true },
        { id: "reveal", label: "Reveal in File Manager" },
        { id: "copy-path", label: "Copy Path" },
      ],
      onSelect: (id) => {
        switch (id) {
          case "new-file":
            void this.createNewFile(path);
            break;
          case "new-folder":
            void this.createNewFolder(path);
            break;
          case "rename":
            void this.renameEntry(node);
            break;
          case "delete":
            void this.deleteEntry(node);
            break;
          case "reveal":
            void openPath(isDir ? path : parentDir(path));
            break;
          case "copy-path":
            void copyTextToClipboard(path);
            break;
        }
      },
    });
  }

  private async createNewFile(baseDir: string): Promise<void> {
    const name = promptInput("New file name");
    if (!name) {
      return;
    }
    const path = joinPath(baseDir, name);
    await createFile(path, "");
    await this.refreshPath(baseDir);
    this.selectPath(path);
    this.callbacks.onFileCreated?.(path);
    this.callbacks.onFileClick(path);
  }

  private async createNewFolder(baseDir: string): Promise<void> {
    const name = promptInput("New folder name");
    if (!name) {
      return;
    }
    const path = joinPath(baseDir, name);
    await createDir(path);
    await this.refreshPath(baseDir);
    this.selectPath(path);
  }

  private async renameEntry(node: TreeNode): Promise<void> {
    const newName = promptInput("Rename to", node.entry.name);
    if (!newName || newName === node.entry.name) {
      return;
    }
    const newPath = joinPath(parentDir(node.entry.path), newName);
    await renamePath(node.entry.path, newPath);
    await this.handleRename(node.entry.path, newPath);
    this.callbacks.onFileRenamed?.(node.entry.path, newPath);
  }

  private async renameSelected(): Promise<void> {
    if (!this.selectedPath) {
      return;
    }
    const node = this.findNode(this.selectedPath);
    if (node) {
      await this.renameEntry(node);
    }
  }

  private async deleteEntry(node: TreeNode): Promise<void> {
    const label = node.entry.is_dir ? "folder" : "file";
    if (
      !confirmAction(
        `Delete ${label} "${node.entry.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    await deletePath(node.entry.path, node.entry.is_dir);
    this.removeNode(node.entry.path);
    this.callbacks.onFileDeleted?.(node.entry.path);
  }

  private async deleteSelected(): Promise<void> {
    if (!this.selectedPath) {
      return;
    }
    const node = this.findNode(this.selectedPath);
    if (node) {
      await this.deleteEntry(node);
    }
  }
}
