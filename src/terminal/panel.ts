import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import type { TerminalCreateResult, TerminalOutputPayload } from "./types";

export type TerminalPanel = {
  sessionId: string | null;
  show: () => void;
  hide: () => void;
  isOpen: () => boolean;
  toggle: () => void;
  fit: () => void;
  focus: () => void;
  bindWorkspace: (cwd: string) => Promise<void>;
  clearSession: () => Promise<void>;
  destroy: () => Promise<void>;
};

const OPEN_KEY = "idepus.terminalOpen";
const HEIGHT_KEY = "idepus.terminalHeight";
const DEFAULT_HEIGHT = 220;
const MIN_HEIGHT = 120;
const MAX_HEIGHT_RATIO = 0.65;

function loadOpen(): boolean {
  return localStorage.getItem(OPEN_KEY) === "1";
}

function loadHeight(): number {
  const raw = localStorage.getItem(HEIGHT_KEY);
  const n = raw ? Number(raw) : DEFAULT_HEIGHT;
  if (!Number.isFinite(n)) {
    return DEFAULT_HEIGHT;
  }
  return n;
}

function readSessionId(result: TerminalCreateResult): string {
  return result.session_id ?? (result as { sessionId?: string }).sessionId ?? "";
}

export function createTerminalPanel(
  panelEl: HTMLElement,
  hostEl: HTMLElement,
  resizerEl: HTMLElement,
  cwdEl: HTMLElement | null,
  closeBtn: HTMLButtonElement | null,
): TerminalPanel {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 12,
    theme: {
      background: "#0f1117",
      foreground: "#e6e8ef",
      cursor: "#7c9cff",
    },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  let mounted = false;
  let sessionId: string | null = null;
  let open = loadOpen();
  let height = loadHeight();
  let unlistenOutput: UnlistenFn | null = null;
  let cwd: string | null = null;
  let binding: Promise<void> | null = null;

  function setCwdLabel(path: string | null): void {
    if (!cwdEl) {
      return;
    }
    cwdEl.textContent = path ?? "";
    cwdEl.title = path ? `Working directory: ${path}` : "";
  }

  function ensureMounted(): void {
    if (mounted) {
      return;
    }
    term.open(hostEl);
    mounted = true;
  }

  function writelnMuted(message: string): void {
    term.writeln(`\x1b[90m${message}\x1b[0m`);
  }

  function maxHeight(): number {
    const stack = panelEl.parentElement;
    if (!stack) {
      return 480;
    }
    return Math.floor(stack.clientHeight * MAX_HEIGHT_RATIO);
  }

  function applyHeight(next: number): void {
    height = Math.min(maxHeight(), Math.max(MIN_HEIGHT, next));
    panelEl.style.height = `${height}px`;
    localStorage.setItem(HEIGHT_KEY, String(height));
    fitInternal();
  }

  function applyOpen(next: boolean): void {
    open = next;
    panelEl.hidden = !open;
    resizerEl.hidden = !open;
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    if (open) {
      ensureMounted();
      requestAnimationFrame(() => {
        fitInternal();
        term.focus();
      });
    }
  }

  function fitInternal(): void {
    if (!open || !mounted) {
      return;
    }
    try {
      fitAddon.fit();
    } catch {
      // host may be zero-sized during layout
    }
    if (sessionId && term.cols > 0 && term.rows > 0) {
      void invoke("terminal_resize", {
        request: {
          session_id: sessionId,
          cols: term.cols,
          rows: term.rows,
        },
      }).catch((err) => console.error("terminal_resize failed:", err));
    }
  }

  async function ensureSession(workspaceCwd: string): Promise<void> {
    if (sessionId && cwd === workspaceCwd) {
      if (open) {
        fitInternal();
      }
      return;
    }

    if (sessionId) {
      await invoke("terminal_destroy", { sessionId }).catch(() => {});
      sessionId = null;
    }

    ensureMounted();
    if (open) {
      fitInternal();
    }

    const result = await invoke<TerminalCreateResult>("terminal_create", {
      request: {
        cwd: workspaceCwd,
        cols: Math.max(term.cols || 80, 80),
        rows: Math.max(term.rows || 24, 24),
      },
    });

    const id = readSessionId(result);
    if (!id) {
      throw new Error("terminal_create returned no session_id");
    }

    sessionId = id;
    cwd = workspaceCwd;
    setCwdLabel(workspaceCwd);
    term.reset();
    if (open) {
      fitInternal();
      term.focus();
    }
  }

  term.onData((data) => {
    if (!sessionId) {
      writelnMuted("Open a workspace folder to use the terminal.");
      return;
    }
    void invoke("terminal_write", {
      request: { session_id: sessionId, data },
    }).catch((err) => {
      console.error("terminal_write failed:", err);
      writelnMuted(`Write failed: ${String(err)}`);
    });
  });

  hostEl.addEventListener("mousedown", () => {
    ensureMounted();
    term.focus();
  });

  let dragging = false;

  resizerEl.addEventListener("mousedown", (event) => {
    event.preventDefault();
    dragging = true;
    document.body.classList.add("terminal-resizing");
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }
    const stack = panelEl.parentElement;
    if (!stack) {
      return;
    }
    const rect = stack.getBoundingClientRect();
    const next = rect.bottom - event.clientY;
    applyHeight(next);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.classList.remove("terminal-resizing");
  });

  window.addEventListener("resize", () => fitInternal());

  closeBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    applyOpen(false);
  });

  applyHeight(height);
  applyOpen(open);

  return {
    get sessionId() {
      return sessionId;
    },
    show() {
      applyOpen(true);
    },
    hide() {
      applyOpen(false);
    },
    isOpen() {
      return open;
    },
    toggle() {
      applyOpen(!open);
    },
    fit: fitInternal,
    focus() {
      ensureMounted();
      term.focus();
    },
    async bindWorkspace(workspaceCwd: string) {
      if (binding) {
        await binding;
      }
      binding = (async () => {
        try {
          await ensureSession(workspaceCwd);
          if (!unlistenOutput) {
            unlistenOutput = await listen<TerminalOutputPayload>(
              "terminal_output",
              (event) => {
                const payload = event.payload;
                const id =
                  payload.session_id ??
                  (payload as { sessionId?: string }).sessionId;
                if (id !== sessionId) {
                  return;
                }
                term.write(payload.data);
              },
            );
          }
        } catch (err) {
          sessionId = null;
          cwd = null;
          setCwdLabel(null);
          ensureMounted();
          term.reset();
          writelnMuted(`Terminal error: ${String(err)}`);
          console.error("terminal bindWorkspace failed:", err);
        } finally {
          binding = null;
        }
      })();
      await binding;
    },
    async destroy() {
      if (unlistenOutput) {
        await unlistenOutput();
        unlistenOutput = null;
      }
      if (sessionId) {
        await invoke("terminal_destroy", { sessionId });
        sessionId = null;
      }
      cwd = null;
      setCwdLabel(null);
      term.dispose();
      mounted = false;
    },
    async clearSession() {
      if (sessionId) {
        await invoke("terminal_destroy", { sessionId });
        sessionId = null;
      }
      cwd = null;
      setCwdLabel(null);
      if (mounted) {
        term.reset();
      }
    },
  };
}
