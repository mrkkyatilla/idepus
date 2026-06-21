import { getActiveRunId } from "../../agent/client";
import { cancelLauncherRun } from "../../agent/run-launcher";
import {
  getAgentMode,
  MODE_ORDER,
  modeLabel,
  saveAgentMode,
  subscribeAgentMode,
  type AgentMode,
} from "../../agent/mode";
import { setLastAgentMode } from "../../session/index";
import { updateActiveSessionMode } from "../../chat/session-store";

export type ModePickerMount = {
  destroy: () => void;
};

export function mountModePicker(
  hostEl: HTMLElement,
  options?: {
    onChange?: (mode: AgentMode, prev: AgentMode) => void;
    onStatus?: (message: string) => void;
  },
): ModePickerMount {
  const root = document.createElement("div");
  root.className = "mode-picker";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Agent mode");

  const buttons = new Map<AgentMode, HTMLButtonElement>();

  for (const mode of MODE_ORDER) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `mode-picker__item mode-picker__item--${mode}`;
    btn.textContent = modeLabel(mode);
    btn.title = modeLabel(mode);
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => {
      void selectMode(mode);
    });
    buttons.set(mode, btn);
    root.appendChild(btn);
  }

  hostEl.appendChild(root);

  function syncActive(): void {
    const active = getAgentMode();
    for (const [mode, btn] of buttons) {
      const isActive = mode === active;
      btn.classList.toggle("mode-picker__item--active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
  }

  async function selectMode(next: AgentMode): Promise<void> {
    const prev = getAgentMode();
    if (next === prev) {
      return;
    }
    if (getActiveRunId() && getAgentMode() !== "multitask") {
      await cancelLauncherRun(options?.onStatus ?? (() => {}));
    }
    saveAgentMode(next);
    updateActiveSessionMode(next);
    setLastAgentMode(next);
    syncActive();
    options?.onChange?.(next, prev);
    const label = modeLabel(next);
    if (next === "ask") {
      options?.onStatus?.(`Switched to ${label} mode — read-only`);
    } else {
      options?.onStatus?.(`Switched to ${label} mode`);
    }
  }

  const unsubscribe = subscribeAgentMode(syncActive);
  syncActive();

  return {
    destroy() {
      unsubscribe();
      root.remove();
    },
  };
}

export async function cycleModeFromKeyboard(
  onStatus?: (message: string) => void,
): Promise<AgentMode> {
  const prev = getAgentMode();
  const idx = MODE_ORDER.indexOf(prev);
  const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length] ?? "agent";
  if (getActiveRunId()) {
    await cancelLauncherRun(onStatus ?? (() => {}));
  }
  saveAgentMode(next);
  updateActiveSessionMode(next);
  setLastAgentMode(next);
  onStatus?.(`Switched to ${modeLabel(next)} mode`);
  return next;
}
