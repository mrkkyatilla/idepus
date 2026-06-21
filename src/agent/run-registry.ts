import { getActiveSessionId } from "../chat/session-store";

export type RunStatus =
  | "running"
  | "suspended"
  | "hitl"
  | "completed"
  | "failed";

export type ActiveRun = {
  runId: string;
  sessionId: string;
  agentId: string;
  status: RunStatus;
  startedAt: number;
  title: string;
};

type Listener = () => void;

let runs = new Map<string, ActiveRun>();
let foregroundRunId: string | null = null;
let maxParallelRuns = 3;
const listeners = new Set<Listener>();

export function setMaxParallelRuns(limit: number): void {
  maxParallelRuns = Math.min(3, Math.max(1, limit));
}

export async function refreshMaxParallelRunsFromSettings(): Promise<void> {
  try {
    const { getMaxParallelRuns } = await import("../research/config");
    maxParallelRuns = await getMaxParallelRuns();
  } catch {
    maxParallelRuns = 3;
  }
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeRunRegistry(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMaxParallelRunsLimit(): number {
  return maxParallelRuns;
}

export function getActiveRuns(): ActiveRun[] {
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function getForegroundRunId(): string | null {
  return foregroundRunId;
}

export function setForegroundRun(runId: string | null): void {
  foregroundRunId = runId;
  notify();
}

export function getRunEntry(runId: string): ActiveRun | null {
  return runs.get(runId) ?? null;
}

export function registerRun(entry: Omit<ActiveRun, "status"> & { status?: RunStatus }): void {
  const run: ActiveRun = {
    ...entry,
    status: entry.status ?? "running",
  };
  runs.set(run.runId, run);
  if (!foregroundRunId) {
    foregroundRunId = run.runId;
  }
  notify();
}

export function updateRunStatus(runId: string, status: RunStatus): void {
  const existing = runs.get(runId);
  if (!existing) {
    return;
  }
  runs.set(runId, { ...existing, status });
  notify();
}

export function unregisterRun(runId: string): void {
  runs.delete(runId);
  if (foregroundRunId === runId) {
    const next = getActiveRuns().find(
      (r) => r.status === "running" || r.status === "hitl" || r.status === "suspended",
    );
    foregroundRunId = next?.runId ?? null;
  }
  notify();
}

export function canStartRun(): { ok: boolean; message?: string } {
  const active = getActiveRuns().filter(
    (r) => r.status === "running" || r.status === "hitl" || r.status === "suspended",
  );
  if (active.length >= maxParallelRuns) {
    return {
      ok: false,
      message: `Maximum ${maxParallelRuns} parallel runs — cancel or wait for one to finish`,
    };
  }
  return { ok: true };
}

export function seedSuspendedRun(entry: ActiveRun): void {
  if (runs.has(entry.runId)) {
    return;
  }
  runs.set(entry.runId, entry);
  notify();
}

export function titleFromInput(input: string): string {
  const line = input.trim().split("\n")[0] ?? "Agent task";
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}

export function registerRunForLaunch(
  runId: string,
  agentId: string,
  input: string,
  sessionId?: string | null,
): void {
  registerRun({
    runId,
    sessionId: sessionId ?? getActiveSessionId() ?? "unknown",
    agentId,
    status: "running",
    startedAt: Date.now(),
    title: titleFromInput(input),
  });
}
