import { describe, expect, it } from "vitest";

import { canStartRun, registerRun, setMaxParallelRuns, unregisterRun } from "./run-registry";
import { canSwitchSession } from "./session-switch";
import { saveAgentMode } from "./mode";

describe("G07+G08 integration", () => {
  it("multitask allows session switch while runs are active", () => {
    saveAgentMode("multitask");
    registerRun({
      runId: "bg-1",
      sessionId: "s1",
      agentId: "explore-planner",
      status: "running",
      startedAt: Date.now(),
      title: "Plan task",
    });
    expect(canSwitchSession()).toBe(true);
    unregisterRun("bg-1");
    saveAgentMode("agent");
  });

  it("enforces parallel run cap from settings", () => {
    setMaxParallelRuns(2);
    registerRun({
      runId: "a",
      sessionId: "s1",
      agentId: "a",
      status: "running",
      startedAt: 1,
      title: "a",
    });
    registerRun({
      runId: "b",
      sessionId: "s2",
      agentId: "a",
      status: "running",
      startedAt: 2,
      title: "b",
    });
    expect(canStartRun().ok).toBe(false);
    unregisterRun("a");
    unregisterRun("b");
    setMaxParallelRuns(3);
  });
});
