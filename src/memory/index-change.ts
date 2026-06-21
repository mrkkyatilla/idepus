import { getActiveSessionId, getWorkspaceId } from "../chat/session-store";
import type { ApprovalRequiredEvent } from "../agent/types";
import { MAX_DIFF_EXCERPT } from "./types";
import { indexChange } from "./persist";

function truncateDiff(text: string, max = MAX_DIFF_EXCERPT): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
}

function summarizeChange(path: string, diffExcerpt: string): string {
  const firstLine = diffExcerpt
    .split("\n")
    .find((l) => l.trim() && !l.startsWith("<<<<") && !l.startsWith("===="));
  if (firstLine) {
    return `Updated ${path}: ${firstLine.trim().slice(0, 120)}`;
  }
  return `Accepted patch to ${path}`;
}

export async function recordAcceptedChange(
  runId: string,
  approval: ApprovalRequiredEvent,
): Promise<void> {
  const workspaceId = getWorkspaceId();
  if (!workspaceId) {
    return;
  }

  const path = String(approval.arguments.path ?? "");
  if (!path || path === ".") {
    return;
  }

  const rawPatch = String(
    approval.arguments.raw_patch ?? approval.arguments.rawPatch ?? "",
  );
  const diffExcerpt = truncateDiff(rawPatch);

  await indexChange({
    id: "",
    workspaceId,
    runId,
    sessionId: getActiveSessionId() ?? undefined,
    path,
    summary: summarizeChange(path, diffExcerpt),
    diffExcerpt,
    acceptedAt: Date.now(),
  });
}
