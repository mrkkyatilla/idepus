import { createTerminalPanel, type TerminalPanel } from "./panel";

let panel: TerminalPanel | null = null;
let workspaceCwd: string | null = null;

export function initTerminal(): TerminalPanel {
  const panelEl = document.querySelector<HTMLElement>("#terminal-panel")!;
  const hostEl = document.querySelector<HTMLElement>("#terminal-host")!;
  const resizerEl = document.querySelector<HTMLElement>("#terminal-resizer")!;
  const cwdEl = document.querySelector<HTMLElement>("#terminal-cwd");
  const closeBtn = document.querySelector<HTMLButtonElement>("#terminal-close");
  panel = createTerminalPanel(panelEl, hostEl, resizerEl, cwdEl, closeBtn);
  return panel;
}

export function getTerminalPanel(): TerminalPanel | null {
  return panel;
}

export function setTerminalWorkspaceCwd(cwd: string | null): void {
  workspaceCwd = cwd;
}

export async function toggleTerminal(): Promise<void> {
  if (!panel) {
    return;
  }

  const opening = !panel.isOpen();
  panel.toggle();

  if (opening) {
    if (workspaceCwd) {
      await panel.bindWorkspace(workspaceCwd);
    } else {
      panel.focus();
    }
    panel.fit();
    panel.focus();
  }
}

export async function onWorkspaceOpened(rootPath: string): Promise<void> {
  workspaceCwd = rootPath;
  if (!panel) {
    return;
  }
  await panel.bindWorkspace(rootPath);
}

export async function unbindTerminalWorkspace(): Promise<void> {
  workspaceCwd = null;
  if (!panel) {
    return;
  }
  await panel.clearSession();
}

export { initTerminalErrorFix, launchTerminalFix } from "./error-fix";
export type { TerminalErrorFixHost } from "./error-fix";

export async function destroyTerminal(): Promise<void> {
  if (!panel) {
    return;
  }
  await panel.destroy();
  panel = null;
  workspaceCwd = null;
}
