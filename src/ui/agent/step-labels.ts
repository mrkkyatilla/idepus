import type { AgentStep } from "../../agent/types";

const STEP_LABELS: Record<string, string> = {
  gather: "Reading files",
  gather_context: "Gathering context",
  explore_loop: "Exploring codebase",
  research: "Researching",
  web_search: "Researching",
  fetch_url: "Researching",
  think_briefly: "Thinking",
  planning_next_moves: "Planning next steps",
  propose_plan: "Drafting plan",
  write_plan: "Saving plan",
  explain: "Explaining file",
  propose_patch: "Drafting changes",
  apply_patch: "Review patch",
  approval_required: "Waiting for your review",
  hitl: "Waiting for your review",
  run_linter: "Running checks",
  run: "Agent run",
  tool: "Tool",
  error: "Failed",
};

export function humanizeStepLabel(label: string): string {
  const normalized = label.trim();
  const lower = normalized.toLowerCase();

  if (lower === "run failed" || lower === "agent error") {
    return normalized;
  }
  if (lower.startsWith("run ") && lower.includes("…")) {
    return "Agent run";
  }

  const key = lower.replace(/\s+/g, "_");
  if (STEP_LABELS[key]) {
    return STEP_LABELS[key];
  }
  for (const [pattern, text] of Object.entries(STEP_LABELS)) {
    if (key.includes(pattern) && pattern !== "run") {
      return text;
    }
  }
  return normalized.replace(/_/g, " ");
}

export function formatStepDuration(step: AgentStep): string | null {
  if (!step.startedAt) {
    return null;
  }
  const end = step.endedAt ?? Date.now();
  const ms = end - step.startedAt;
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

export type StepChipType =
  | "think"
  | "explore"
  | "grep"
  | "read"
  | "planning"
  | "editing"
  | "waiting"
  | "lint_check"
  | "research"
  | "default";

const CHIP_TYPE_MAP: Record<string, StepChipType> = {
  gather: "read",
  gather_context: "explore",
  explore_loop: "explore",
  research: "research",
  web_search: "research",
  fetch_url: "research",
  think_briefly: "think",
  planning_next_moves: "planning",
  propose_plan: "planning",
  write_plan: "planning",
  read: "read",
  read_file: "read",
  explain: "research",
  search: "grep",
  search_codebase: "grep",
  grep: "grep",
  list_dir: "explore",
  explore: "explore",
  plan: "planning",
  planning: "planning",
  propose_patch: "editing",
  apply_patch: "editing",
  editing: "editing",
  approval_required: "waiting",
  hitl: "waiting",
  waiting: "waiting",
  run_linter: "lint_check",
  lint_check: "lint_check",
  think: "think",
};

export function stepChipType(label: string): StepChipType {
  const key = label.trim().toLowerCase().replace(/\s+/g, "_");
  if (CHIP_TYPE_MAP[key]) {
    return CHIP_TYPE_MAP[key];
  }
  for (const [pattern, type] of Object.entries(CHIP_TYPE_MAP)) {
    if (key.includes(pattern)) {
      return type;
    }
  }
  return "default";
}

export function stepIcon(status: AgentStep["status"]): string {
  switch (status) {
    case "done":
      return "✓";
    case "error":
      return "✗";
    case "running":
      return "◐";
    default:
      return "○";
  }
}
