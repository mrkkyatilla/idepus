import type { ApprovalRequiredEvent } from "./types";

export type PatchQueueStatus =
  | "pending"
  | "reviewing"
  | "staged"
  | "accepted"
  | "rejected"
  | "shadow_failed";

export type QueuedPatch = {
  id: string;
  path: string;
  approval: ApprovalRequiredEvent;
  status: PatchQueueStatus;
  snapshot?: string;
  runId?: string;
};

const MAX_QUEUE = 20;

let queue: QueuedPatch[] = [];
let processing = false;
let reviewingSince: number | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function newId(): string {
  return `patch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function subscribePatchQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPatchQueue(): QueuedPatch[] {
  return [...queue];
}

export function clearPatchQueue(): void {
  queue = [];
  processing = false;
  reviewingSince = null;
  notify();
}

export function hydratePatchQueue(items: QueuedPatch[]): void {
  queue = items
    .filter(
      (item) =>
        item.status === "pending" ||
        item.status === "reviewing" ||
        item.status === "staged",
    )
    .slice(-MAX_QUEUE);
  processing = false;
  notify();
}

export function enqueuePatch(
  approval: ApprovalRequiredEvent,
  runId?: string,
): QueuedPatch | null {
  const path = String(approval.arguments.path ?? "");
  if (!path || path === ".") {
    return null;
  }
  if (queue.some((item) => item.approval.approval_id === approval.approval_id)) {
    return queue.find((item) => item.approval.approval_id === approval.approval_id) ?? null;
  }
  if (queue.length >= MAX_QUEUE) {
    return null;
  }
  const item: QueuedPatch = {
    id: newId(),
    path,
    approval,
    status: "pending",
    runId,
  };
  queue = [...queue, item];
  notify();
  return item;
}

export function isQueueProcessing(): boolean {
  return processing;
}

export function setQueueProcessing(value: boolean): void {
  processing = value;
  notify();
}

export function getNextPending(): QueuedPatch | null {
  return queue.find((item) => item.status === "pending") ?? null;
}

export function getReviewingItem(): QueuedPatch | null {
  return queue.find((item) => item.status === "reviewing") ?? null;
}

export function updatePatchStatus(
  id: string,
  status: PatchQueueStatus,
  snapshot?: string,
): void {
  queue = queue.map((item) =>
    item.id === id
      ? { ...item, status, snapshot: snapshot ?? item.snapshot }
      : item,
  );
  notify();
}

export function updatePatchByApprovalId(
  approvalId: string,
  status: PatchQueueStatus,
  snapshot?: string,
): void {
  queue = queue.map((item) =>
    item.approval.approval_id === approvalId
      ? { ...item, status, snapshot: snapshot ?? item.snapshot }
      : item,
  );
  notify();
}

export function hasPendingPatches(): boolean {
  return queue.some((item) => item.status === "pending");
}

export function getStagedPatches(): QueuedPatch[] {
  return queue.filter((item) => item.status === "staged");
}

export function hasStagedPatches(): boolean {
  return queue.some((item) => item.status === "staged");
}

export function hasBatchReviewPending(): boolean {
  return hasStagedPatches();
}

export function getPatchByApprovalId(approvalId: string): QueuedPatch | null {
  return queue.find((item) => item.approval.approval_id === approvalId) ?? null;
}

export function getAcceptedPatchPaths(): string[] {
  return queue
    .filter((item) => item.status === "accepted")
    .map((item) => item.path);
}

let queueResumeHandler:
  | ((runId: string, approvalId: string, accepted: boolean) => void)
  | null = null;

export function setQueueResumeHandler(
  handler: (runId: string, approvalId: string, accepted: boolean) => void,
): void {
  queueResumeHandler = handler;
}

export function notifyQueueResume(
  runId: string,
  approvalId: string,
  accepted: boolean,
): void {
  queueResumeHandler?.(runId, approvalId, accepted);
}

export function markReviewing(id: string): void {
  reviewingSince = Date.now();
  queue = queue.map((item) => ({
    ...item,
    status: item.id === id ? "reviewing" : item.status === "reviewing" ? "pending" : item.status,
  }));
  notify();
}

export function clearReviewingClock(): void {
  reviewingSince = null;
}

/** Reset a patch stuck in reviewing back to pending for retry. */
export function resetStuckReviewing(maxMs = 30_000): boolean {
  const item = getReviewingItem();
  if (!item || reviewingSince === null) {
    return false;
  }
  if (Date.now() - reviewingSince < maxMs) {
    return false;
  }
  queue = queue.map((entry) =>
    entry.id === item.id ? { ...entry, status: "pending" as const } : entry,
  );
  reviewingSince = null;
  notify();
  return true;
}
