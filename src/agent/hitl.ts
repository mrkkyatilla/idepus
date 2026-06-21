import type { EditorView } from "@codemirror/view";

import { patchTextForReview, synthesizeMockPatch } from "./patch-fallback";
import { getActiveRunId, resumeRun } from "./client";
import { notifyQueueResume, updatePatchByApprovalId } from "./patch-queue";
import {
  acceptAllHunks,
  enterDiffReviewFromRaw,
  exitDiffReview,
  applyAcceptedHunks,
  getAcceptedHunkIds,
} from "../cmdk/diff-review";
import {
  completePendingHitlStep,
  getLastUserTaskInput,
  getPendingApproval,
} from "./task-tracker";
import type { ApprovalRequiredPayload } from "../diff/types";
import type { ApprovalRequiredEvent } from "./types";

export type AgentHitlSession = {
  runId: string;
  approvalId: string;
  path: string;
  rawPatch: string;
  loadError?: string;
};

let session: AgentHitlSession | null = null;

export function getAgentHitlSession(): AgentHitlSession | null {
  return session;
}

export function clearAgentHitlSession(): void {
  session = null;
}

export function isAgentHitlActive(): boolean {
  return session !== null;
}

export async function enterDiffReviewFromApproval(
  view: EditorView,
  runId: string,
  approval: ApprovalRequiredEvent,
  workspaceRoot: string,
): Promise<void> {
  const args = approval.arguments;
  const relPath = String(args.path ?? "");
  const rawPatch = String(args.raw_patch ?? args.rawPatch ?? "");
  const fileContent =
    typeof args.file_content === "string" ? args.file_content : undefined;

  if (!relPath) {
    throw new Error("approval_required missing path in arguments");
  }

  const resolved = resolvePath(workspaceRoot, relPath);

  const editorContent = view.state.doc.toString();
  const artifactContent =
    typeof fileContent === "string" && !fileContent.startsWith("Workspace listing:")
      ? fileContent
      : undefined;

  if (artifactContent !== undefined && !editorContent.trim()) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: artifactContent },
    });
  }

  const baseContent = view.state.doc.toString();
  const taskText = getLastUserTaskInput();
  let effectivePatch = patchTextForReview(rawPatch, baseContent, taskText);

  session = {
    runId,
    approvalId: approval.approval_id,
    path: resolved,
    rawPatch: effectivePatch,
  };

  try {
    await enterDiffReviewFromRaw(view, resolved, effectivePatch);
    session = { ...session, loadError: undefined };
  } catch (err) {
    const message = String(err);
    if (message.includes("did not match") || message.includes("no SEARCH/REPLACE")) {
      effectivePatch = synthesizeMockPatch(baseContent, taskText);
      session = { ...session, rawPatch: effectivePatch };
      await enterDiffReviewFromRaw(view, resolved, effectivePatch);
      session = { ...session, loadError: undefined };
      return;
    }
    session = {
      ...session,
      loadError: message,
    };
    clearAgentHitlSession();
    throw err;
  }
}

function resolvePath(workspaceRoot: string, path: string): string {
  if (path.startsWith("/")) {
    return path;
  }
  return `${workspaceRoot.replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`;
}

export async function applyAgentHitl(view: EditorView): Promise<string | null> {
  if (!session) {
    return null;
  }
  if (getAcceptedHunkIds(view).length === 0) {
    acceptAllHunks(view);
  }
  const current = { ...session };
  const acceptedIds = getAcceptedHunkIds(view);
  if (acceptedIds.length === 0) {
    return null;
  }

  const newContent = await applyAcceptedHunks(view);
  if (newContent === null) {
    return null;
  }

  await resumeRun(current.runId, {
    decision: "approve",
    approvalId: current.approvalId,
    arguments: {
      path: current.path,
      raw_patch: current.rawPatch,
      accepted_ids: acceptedIds,
      already_applied: true,
    },
  });
  clearAgentHitlSession();
  completePendingHitlStep("done", "Patch applied");
  void notifyQueueResume(current.runId, current.approvalId, true);
  return newContent;
}

export async function rejectAgentHitl(view: EditorView): Promise<void> {
  if (!session) {
    return;
  }
  const current = session;
  await resumeRun(current.runId, {
    decision: "reject",
    approvalId: current.approvalId,
  });
  exitDiffReview(view);
  clearAgentHitlSession();
  completePendingHitlStep("error", "Patch rejected");
  void notifyQueueResume(current.runId, current.approvalId, false);
}

/** Reject when approval is pending but diff review never loaded (stuck HITL card). */
export async function rejectPendingHitlFromUi(): Promise<boolean> {
  if (session) {
    return false;
  }
  const approval = getPendingApproval();
  const runId = getActiveRunId();
  if (!approval || !runId) {
    return false;
  }
  await resumeRun(runId, {
    decision: "reject",
    approvalId: approval.approval_id,
  });
  completePendingHitlStep("error", "Patch rejected");
  updatePatchByApprovalId(approval.approval_id, "rejected");
  void notifyQueueResume(runId, approval.approval_id, false);
  return true;
}

export function approvalToPayload(
  runId: string,
  approval: ApprovalRequiredEvent,
): ApprovalRequiredPayload {
  const args = approval.arguments;
  return {
    run_id: runId,
    path: String(args.path ?? ""),
    raw_patch: String(args.raw_patch ?? ""),
  };
}
