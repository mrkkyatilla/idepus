import { beforeEach, describe, expect, it, vi } from "vitest";

import { getActiveRunId, resumeRun } from "./client";
import { rejectPendingHitlFromUi } from "./hitl";
import { notifyQueueResume, updatePatchByApprovalId } from "./patch-queue";
import {
  completePendingHitlStep,
  getPendingApproval,
  handleSseEvent,
  hasPendingHitlStep,
} from "./task-tracker";

vi.mock("./client", () => ({
  getActiveRunId: vi.fn(),
  resumeRun: vi.fn(),
}));

vi.mock("./patch-queue", () => ({
  notifyQueueResume: vi.fn(),
  updatePatchByApprovalId: vi.fn(),
}));

vi.mock("./mode", () => ({
  getAgentMode: () => "ask",
  modeAllowsPatch: () => false,
}));

describe("HITL pending approval recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleSseEvent({
      event: "approval_required",
      data: {
        approval_id: "ap-1",
        tool_name: "apply_patch",
        arguments: { path: "src/foo.ts", raw_patch: "patch" },
      },
    });
  });

  it("completePendingHitlStep clears stuck approval_required step", () => {
    expect(hasPendingHitlStep()).toBe(true);
    completePendingHitlStep("error", "Could not open patch review");
    expect(hasPendingHitlStep()).toBe(false);
    expect(getPendingApproval()).toBeNull();
  });

  it("rejectPendingHitlFromUi resumes agent and clears pending step", async () => {
    vi.mocked(getActiveRunId).mockReturnValue("run-1");
    vi.mocked(resumeRun).mockResolvedValue({
      id: "run-1",
      status: "running",
      agent_id: "code-editor",
    });

    const rejected = await rejectPendingHitlFromUi();

    expect(rejected).toBe(true);
    expect(resumeRun).toHaveBeenCalledWith("run-1", {
      decision: "reject",
      approvalId: "ap-1",
    });
    expect(updatePatchByApprovalId).toHaveBeenCalledWith("ap-1", "rejected");
    expect(notifyQueueResume).toHaveBeenCalledWith("run-1", "ap-1", false);
    expect(hasPendingHitlStep()).toBe(false);
  });
});
