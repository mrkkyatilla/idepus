import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  clearPatchQueue,
  enqueuePatch,
  getPatchQueue,
  getNextPending,
  getStagedPatches,
  hasStagedPatches,
  markReviewing,
  resetStuckReviewing,
  updatePatchStatus,
} from "./patch-queue";
import type { ApprovalRequiredEvent } from "./types";

function mockApproval(path: string, id = "ap-1"): ApprovalRequiredEvent {
  return {
    approval_id: id,
    tool_name: "apply_patch",
    arguments: { path, raw_patch: "<<<<\n====\n>>>>" },
  };
}

beforeEach(() => {
  clearPatchQueue();
});

describe("patch-queue", () => {
  it("enqueues and returns pending item", () => {
    const item = enqueuePatch(mockApproval("src/foo.ts"));
    expect(item).not.toBeNull();
    expect(getPatchQueue()).toHaveLength(1);
    expect(getNextPending()?.path).toBe("src/foo.ts");
  });

  it("rejects root path", () => {
    expect(enqueuePatch(mockApproval("."))).toBeNull();
    expect(getPatchQueue()).toHaveLength(0);
  });

  it("deduplicates by approval_id", () => {
    enqueuePatch(mockApproval("a.ts", "same"));
    enqueuePatch(mockApproval("b.ts", "same"));
    expect(getPatchQueue()).toHaveLength(1);
  });

  it("updates status", () => {
    const item = enqueuePatch(mockApproval("x.ts"))!;
    updatePatchStatus(item.id, "accepted");
    expect(getPatchQueue()[0]?.status).toBe("accepted");
  });

  it("tracks staged patches for batch review", () => {
    const item = enqueuePatch(mockApproval("a.ts"), "run-1")!;
    updatePatchStatus(item.id, "staged");
    expect(hasStagedPatches()).toBe(true);
    expect(getStagedPatches()[0]?.runId).toBe("run-1");
  });

  it("resets stuck reviewing patches to pending", () => {
    const item = enqueuePatch(mockApproval("stuck.ts"))!;
    markReviewing(item.id);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31_000);
    expect(resetStuckReviewing()).toBe(true);
    expect(getNextPending()?.path).toBe("stuck.ts");
    vi.useRealTimers();
  });
});
