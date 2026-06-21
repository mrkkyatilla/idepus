import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { getActiveRunId } from "../agent/client";
import type { RunLauncherOptions } from "../agent/run-launcher";
import { launchAgentRun } from "../agent/run-launcher";
import type { TerminalContext } from "./types";

function formatTerminalPrompt(context: TerminalContext): string {
  const fileRefs = [
    ...new Set(
      context.patterns
        .map((p) => p.file)
        .filter((f): f is string => Boolean(f)),
    ),
  ].slice(0, 5);

  const lines = context.lines.join("\n");
  const files =
    fileRefs.length > 0 ? fileRefs.join(", ") : "(none parsed — use terminal output)";

  return [
    `Terminal errors in workspace ${context.cwd}:`,
    "",
    lines,
    "",
    `Affected files: ${files}`,
    "",
    "Fix the errors with minimal SEARCH/REPLACE patches. Read affected files first.",
  ].join("\n");
}

export async function launchTerminalFix(
  context: TerminalContext,
  host: RunLauncherOptions,
): Promise<void> {
  const prompt = formatTerminalPrompt(context);
  await launchAgentRun(prompt, { ...host, agentId: "lint-fix" });
}

export type TerminalErrorFixHost = RunLauncherOptions & {
  getSessionId: () => string | null;
  onStatus: (message: string) => void;
};

export function initTerminalErrorFix(host: TerminalErrorFixHost): () => void {
  const statusbar = document.querySelector<HTMLElement>(".statusbar")!;
  let fixBtn = statusbar.querySelector<HTMLButtonElement>("#terminal-fix-btn");
  if (!fixBtn) {
    fixBtn = document.createElement("button");
    fixBtn.id = "terminal-fix-btn";
    fixBtn.type = "button";
    fixBtn.className = "btn btn-primary btn-sm";
    fixBtn.hidden = true;
    fixBtn.textContent = "Fix with Agent";
    statusbar.insertBefore(fixBtn, statusbar.querySelector("#stream-cancel"));
  }

  let activeSessionId: string | null = null;
  const unlisteners: UnlistenFn[] = [];

  function hideButton(): void {
    activeSessionId = null;
    fixBtn!.hidden = true;
  }

  function showButton(sessionId: string): void {
    activeSessionId = sessionId;
    fixBtn!.hidden = false;
    fixBtn!.disabled = Boolean(getActiveRunId());
  }

  function refreshDisabled(): void {
    if (!fixBtn!.hidden) {
      fixBtn!.disabled = Boolean(getActiveRunId());
    }
  }

  fixBtn.addEventListener("click", () => {
    const sessionId = host.getSessionId();
    if (!sessionId || getActiveRunId()) {
      return;
    }
    void (async () => {
      try {
        const context = await invoke<TerminalContext>("get_terminal_context", {
          request: { session_id: sessionId, line_count: 50 },
        });
        host.onStatus("Starting lint-fix agent…");
        await launchTerminalFix(context, host);
      } catch (err) {
        host.onStatus(`Terminal fix failed: ${String(err)}`);
      }
    })();
  });

  void listen("terminal_error_detected", (event) => {
    const payload = event.payload as { session_id: string };
    const current = host.getSessionId();
    if (current && payload.session_id !== current) {
      return;
    }
    showButton(payload.session_id);
  }).then((fn) => unlisteners.push(fn));

  void listen("terminal_errors_cleared", (event) => {
    const payload = event.payload as { session_id: string };
    if (activeSessionId === payload.session_id) {
      hideButton();
    }
  }).then((fn) => unlisteners.push(fn));

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeSessionId) {
      hideButton();
    }
  });

  const interval = window.setInterval(refreshDisabled, 500);

  return () => {
    for (const fn of unlisteners) {
      void fn();
    }
    window.clearInterval(interval);
    fixBtn?.remove();
  };
}
