export type AgentMode = "agent" | "plan" | "ask" | "multitask";

export const MODE_ORDER: AgentMode[] = ["agent", "plan", "ask", "multitask"];

const STORAGE_KEY = "idepus.agent.mode";

const MODE_LABELS: Record<AgentMode, string> = {
  agent: "Agent",
  plan: "Plan",
  ask: "Ask",
  multitask: "Multitask",
};

const DEFAULT_AGENTS: Record<AgentMode, string> = {
  agent: "multi-file-editor",
  plan: "explore-planner",
  ask: "code-explorer",
  multitask: "multi-file-editor",
};

let currentMode: AgentMode = loadAgentMode();
const listeners = new Set<() => void>();

function isAgentMode(value: string): value is AgentMode {
  return MODE_ORDER.includes(value as AgentMode);
}

export function getAgentMode(): AgentMode {
  return currentMode;
}

export function loadAgentMode(): AgentMode {
  if (typeof localStorage === "undefined") {
    return "agent";
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw && isAgentMode(raw)) {
    return raw;
  }
  return "agent";
}

export function saveAgentMode(mode: AgentMode): void {
  currentMode = mode;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, mode);
  }
  for (const listener of listeners) {
    listener();
  }
}

export function setAgentMode(mode: AgentMode): void {
  if (mode === currentMode) {
    return;
  }
  saveAgentMode(mode);
}

export function cycleAgentMode(from: AgentMode = currentMode): AgentMode {
  const idx = MODE_ORDER.indexOf(from);
  const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length] ?? "agent";
  saveAgentMode(next);
  return next;
}

export function defaultAgentForMode(mode: AgentMode): string {
  return DEFAULT_AGENTS[mode];
}

export function modeLabel(mode: AgentMode): string {
  return MODE_LABELS[mode];
}

export function modeAllowsPatch(mode: AgentMode): boolean {
  return mode === "agent" || mode === "multitask";
}

export function subscribeAgentMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyAgentModeFromSnapshot(mode?: AgentMode): void {
  if (mode && isAgentMode(mode)) {
    currentMode = mode;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, mode);
    }
    for (const listener of listeners) {
      listener();
    }
  }
}
