import type { EditorView } from "@codemirror/view";

import { getActiveRunId } from "./client";
import { enterDiffReviewFromApproval } from "./hitl";
import type { ApprovalRequiredEvent } from "./types";
import { getPendingApproval, pokeTaskTracker, setStreamNote } from "./task-tracker";

export type HitlFlowOptions = {
  workspaceRoot?: string;
  getEditorView: () => EditorView | null;
  getActiveFilePath?: () => string | undefined;
  openFile: (path: string, fallbackContent?: string) => Promise<void>;
  onStatus: (message: string) => void;
};

let openingReview: Promise<boolean> | null = null;

export function isPatchReviewOpening(): boolean {
  return openingReview !== null;
}

function pathsMatch(expected: string, actual: string | undefined): boolean {
  if (!actual) {
    return false;
  }
  if (expected === actual) {
    return true;
  }
  const expectedName = expected.split(/[/\\]/).pop();
  const actualName = actual.split(/[/\\]/).pop();
  return Boolean(expectedName && actualName && expectedName === actualName);
}

async function waitForEditorReady(
  options: HitlFlowOptions,
  expectedPath: string,
  maxMs = 5000,
): Promise<EditorView | null> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const view = options.getEditorView();
    const activePath = options.getActiveFilePath?.();
    if (view && pathsMatch(expectedPath, activePath)) {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const view = options.getEditorView();
  const activePath = options.getActiveFilePath?.();
  if (view && pathsMatch(expectedPath, activePath)) {
    return view;
  }
  return null;
}

async function openPatchReviewInner(
  runId: string,
  approval: ApprovalRequiredEvent,
  options: HitlFlowOptions,
): Promise<boolean> {
  if (!options.workspaceRoot) {
    options.onStatus("Open a workspace folder first");
    return false;
  }

  const relPath = String(approval.arguments.path ?? "");
  if (!relPath || relPath === ".") {
    const message = "No valid file path for patch review";
    setStreamNote(message);
    pokeTaskTracker();
    options.onStatus(message);
    return false;
  }

  const fileContentArg = approval.arguments.file_content;
  const fallbackContent =
    typeof fileContentArg === "string" &&
    !fileContentArg.startsWith("Workspace listing:")
      ? fileContentArg
      : undefined;

  const absPath = relPath.startsWith("/")
    ? relPath
    : `${options.workspaceRoot}/${relPath.replace(/^\.\//, "")}`;

  try {
    await options.openFile(absPath, fallbackContent);

    const view = await waitForEditorReady(options, absPath || relPath);
    if (!view) {
      options.onStatus("Open a file in the editor to review the patch");
      return false;
    }

    await enterDiffReviewFromApproval(view, runId, approval, options.workspaceRoot);
    pokeTaskTracker();
    options.onStatus(`Review patch: ${relPath || absPath}`);
    return true;
  } catch (err) {
    const message = String(err);
    setStreamNote(
      `Could not open diff for ${relPath || absPath}: ${message}`,
    );
    pokeTaskTracker();
    options.onStatus(`Patch review failed: ${message}`);
    return false;
  }
}

export async function openPatchReview(
  runId: string,
  approval: ApprovalRequiredEvent,
  options: HitlFlowOptions,
): Promise<boolean> {
  if (openingReview) {
    return openingReview;
  }
  openingReview = openPatchReviewInner(runId, approval, options).finally(() => {
    openingReview = null;
    pokeTaskTracker();
  });
  return openingReview;
}

export async function retryPendingPatchReview(
  options: HitlFlowOptions,
): Promise<void> {
  const runId = getActiveRunId();
  const approval = getPendingApproval();
  if (!runId || !approval) {
    options.onStatus("No patch waiting for review");
    return;
  }
  await openPatchReview(runId, approval, options);
}
