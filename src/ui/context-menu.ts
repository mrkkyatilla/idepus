export type ContextMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
};

export type ContextMenuOptions = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onSelect: (id: string) => void;
};

let activeMenu: HTMLElement | null = null;

export function showContextMenu(options: ContextMenuOptions): void {
  dismissContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = `${options.x}px`;
  menu.style.top = `${options.y}px`;

  for (const item of options.items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "context-menu-sep";
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "context-menu-item";
    if (item.danger) {
      btn.classList.add("context-menu-item--danger");
    }
    btn.textContent = item.label;
    btn.disabled = item.disabled ?? false;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!btn.disabled) {
        options.onSelect(item.id);
        dismissContextMenu();
      }
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  activeMenu = menu;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${Math.max(4, options.x - rect.width)}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${Math.max(4, options.y - rect.height)}px`;
  }

  const onDismiss = (event: MouseEvent) => {
    if (menu.contains(event.target as Node)) {
      return;
    }
    dismissContextMenu();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      dismissContextMenu();
    }
  };

  window.setTimeout(() => {
    document.addEventListener("mousedown", onDismiss);
    document.addEventListener("keydown", onKey);
    menu.dataset.dismissBound = "1";
    menu.addEventListener(
      "remove",
      () => {
        document.removeEventListener("mousedown", onDismiss);
        document.removeEventListener("keydown", onKey);
      },
      { once: true },
    );
  }, 0);
}

export function dismissContextMenu(): void {
  activeMenu?.remove();
  activeMenu = null;
}

export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function promptInput(
  message: string,
  defaultValue = "",
): string | null {
  const value = window.prompt(message, defaultValue);
  if (value === null || !value.trim()) {
    return null;
  }
  return value.trim();
}

export function confirmAction(message: string): boolean {
  return window.confirm(message);
}
