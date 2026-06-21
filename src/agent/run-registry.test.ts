import { describe, expect, it } from "vitest";

import {
  canStartRun,
  getActiveRuns,
  registerRun,
  setMaxParallelRuns,
  unregisterRun,
} from "./run-registry";

describe("run-registry", () => {
  it("limits parallel runs", () => {
    setMaxParallelRuns(2);
    registerRun({
      runId: "r1",
      sessionId: "s1",
      agentId: "a",
      status: "running",
      startedAt: Date.now(),
      title: "one",
    });
    registerRun({
      runId: "r2",
      sessionId: "s2",
      agentId: "a",
      status: "running",
      startedAt: Date.now(),
      title: "two",
    });
    expect(canStartRun().ok).toBe(false);
    unregisterRun("r1");
    expect(canStartRun().ok).toBe(true);
    expect(getActiveRuns()).toHaveLength(1);
    unregisterRun("r2");
  });
});
