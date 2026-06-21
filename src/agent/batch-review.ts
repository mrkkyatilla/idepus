import { applyPatchFromApproval } from "./patch-apply";
import {
  getPatchQueue,
  getStagedPatches,
  hasStagedPatches,
  subscribePatchQueue,
  updatePatchStatus,
  type QueuedPatch,
} from "./patch-queue";
import { recordAcceptedChange } from "../memory/index-change";

export function subscribeBatchReview(listener: () => void): () => void {
  return subscribePatchQueue(listener);
}

export function isBatchReviewActive(): boolean {
  return hasStagedPatches();
}

function resolveStaged(item: QueuedPatch): QueuedPatch | null {
  const current = getPatchQueue().find((entry) => entry.id === item.id);
  if (!current || current.status !== "staged") {
    return null;
  }
  return current;
}

export async function acceptStagedPatch(
  item: QueuedPatch,
  workspaceRoot: string,
): Promise<void> {
  const current = resolveStaged(item);
  if (!current) {
    return;
  }
  await applyPatchFromApproval(workspaceRoot, current.approval);
  updatePatchStatus(current.id, "accepted");
  const runId = current.runId ?? "batch";
  void recordAcceptedChange(runId, current.approval);
}

export function rejectStagedPatch(item: QueuedPatch): void {
  const current = resolveStaged(item);
  if (!current) {
    return;
  }
  updatePatchStatus(current.id, "rejected");
}

export async function acceptAllStaged(workspaceRoot: string): Promise<void> {
  const staged = getStagedPatches();
  for (const item of staged) {
    await acceptStagedPatch(item, workspaceRoot);
  }
}

export function rejectAllStaged(): void {
  for (const item of getStagedPatches()) {
    rejectStagedPatch(item);
  }
}
