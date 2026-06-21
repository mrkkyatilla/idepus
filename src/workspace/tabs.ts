import type { EditorTab } from "./types";

export type TabStoreCallbacks = {
  onTabsChange: () => void;
  onActiveTabChange: (tab: EditorTab | null) => void;
};

export class TabStore {
  private tabs: EditorTab[] = [];
  private activeId: string | null = null;
  private callbacks: TabStoreCallbacks;

  constructor(callbacks: TabStoreCallbacks) {
    this.callbacks = callbacks;
  }

  getTabs(): EditorTab[] {
    return this.tabs;
  }

  getActiveTab(): EditorTab | null {
    if (!this.activeId) {
      return null;
    }
    return this.tabs.find((t) => t.id === this.activeId) ?? null;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  findByPath(path: string): EditorTab | undefined {
    return this.tabs.find((t) => t.path === path);
  }

  openTab(path: string, content: string): EditorTab {
    const existing = this.findByPath(path);
    if (existing) {
      this.setActive(existing.id);
      return existing;
    }

    const name = path.split(/[/\\]/).pop() ?? path;
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      path,
      name,
      dirty: false,
      content,
    };
    this.tabs.push(tab);
    this.setActive(tab.id);
    this.callbacks.onTabsChange();
    return tab;
  }

  setActive(id: string): void {
    if (this.activeId === id) {
      return;
    }
    this.activeId = id;
    this.callbacks.onTabsChange();
    this.callbacks.onActiveTabChange(this.getActiveTab());
  }

  updateActiveContent(content: string, dirty?: boolean): void {
    const tab = this.getActiveTab();
    if (!tab) {
      return;
    }
    tab.content = content;
    if (dirty !== undefined) {
      tab.dirty = dirty;
    }
    this.callbacks.onTabsChange();
  }

  markActiveDirty(): void {
    const tab = this.getActiveTab();
    if (!tab || tab.dirty) {
      return;
    }
    tab.dirty = true;
    this.callbacks.onTabsChange();
  }

  markActiveClean(): void {
    const tab = this.getActiveTab();
    if (!tab) {
      return;
    }
    tab.dirty = false;
    this.callbacks.onTabsChange();
  }

  reloadTabContent(path: string, content: string): void {
    const tab = this.findByPath(path);
    if (!tab) {
      return;
    }
    tab.content = content;
    tab.dirty = false;
    if (tab.id === this.activeId) {
      this.callbacks.onActiveTabChange(tab);
    }
    this.callbacks.onTabsChange();
  }

  renameTabPath(oldPath: string, newPath: string): void {
    const tab = this.findByPath(oldPath);
    if (!tab) {
      return;
    }
    tab.path = newPath;
    tab.name = newPath.split(/[/\\]/).pop() ?? newPath;
    if (tab.id === this.activeId) {
      this.callbacks.onActiveTabChange(tab);
    }
    this.callbacks.onTabsChange();
  }

  closeTabByPath(path: string, force = false): boolean {
    const tab = this.findByPath(path);
    if (!tab) {
      return false;
    }
    return this.closeTab(tab.id, force);
  }

  closeTab(id: string, force = false): boolean {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) {
      return false;
    }

    if (tab.dirty && !force) {
      const ok = confirm(
        `"${tab.name}" has unsaved changes. Close anyway?`,
      );
      if (!ok) {
        return false;
      }
    }

    const idx = this.tabs.findIndex((t) => t.id === id);
    this.tabs.splice(idx, 1);

    if (this.activeId === id) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1] ?? null;
      this.activeId = next?.id ?? null;
      this.callbacks.onActiveTabChange(next);
    }

    this.callbacks.onTabsChange();
    return true;
  }

  closeActiveTab(): boolean {
    if (!this.activeId) {
      return false;
    }
    return this.closeTab(this.activeId);
  }
}

export function renderTabBar(
  container: HTMLElement,
  store: TabStore,
  onSelect: (id: string) => void,
  onClose: (id: string) => void,
): void {
  container.innerHTML = "";
  const tabs = store.getTabs();
  const activeId = store.getActiveId();

  if (tabs.length === 0) {
    container.hidden = true;
    return;
  }

  container.hidden = false;

  for (const tab of tabs) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "tab";
    if (tab.id === activeId) {
      el.classList.add("tab--active");
    }
    if (tab.dirty) {
      el.classList.add("tab--dirty");
    }

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = tab.dirty ? `${tab.name} *` : tab.name;
    el.appendChild(label);

    const closeBtn = document.createElement("span");
    closeBtn.className = "tab-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      onClose(tab.id);
    });
    el.appendChild(closeBtn);

    el.addEventListener("click", () => onSelect(tab.id));
    container.appendChild(el);
  }
}
