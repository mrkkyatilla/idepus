import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptStagedPatch,
  isBatchReviewActive,
  rejectAllStaged,
  rejectStagedPatch,
} from "./batch-review";
import { clearPatchQueue, enqueuePatch, getPatchQueue, updatePatchStatus } from "./patch-queue";
import type { ApprovalRequiredEvent } from "./types";

vi.mock("./patch-apply", () => ({
  applyPatchFromApproval: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../memory/index-change", () => ({
  recordAcceptedChange: vi.fn(),
}));

function mockApproval(path: string): ApprovalRequiredEvent {
  return {
    approval_id: `ap-${path}`,
    tool_name: "apply_patch",
    arguments: { path, raw_patch: "<<<<\n====\n>>>>" },
  };
}

beforeEach(() => {
  clearPatchQueue();
  vi.clearAllMocks();
});

describe("batch-review", () => {
  it("detects active batch review when staged patches exist", () => {
    expect(isBatchReviewActive()).toBe(false);
    const item = enqueuePatch(mockApproval("src/a.ts"))!;
    updatePatchStatus(item.id, "staged");
    expect(isBatchReviewActive()).toBe(true);
  });

  it("accepts a staged patch via bridge apply", async () => {
    const { applyPatchFromApproval } = await import("./patch-apply");
    const item = enqueuePatch(mockApproval("src/b.ts"))!;
    updatePatchStatus(item.id, "staged");
    await acceptStagedPatch(item, "/workspace");
    expect(applyPatchFromApproval).toHaveBeenCalledOnce();
    expect(getPatchQueue()[0]?.status).toBe("accepted");
  });

  it("rejects all staged patches without applying", async () => {
    const { applyPatchFromApproval } = await import("./patch-apply");
    const a = enqueuePatch(mockApproval("a.ts", "ap-a"))!;
    const b = enqueuePatch(mockApproval("b.ts", "ap-b"))!;
    updatePatchStatus(a.id, "staged");
    updatePatchStatus(b.id, "staged");
    rejectAllStaged();
    expect(applyPatchFromApproval).not.toHaveBeenCalled();
    expect(isBatchReviewActive()).toBe(false);
  });
});
