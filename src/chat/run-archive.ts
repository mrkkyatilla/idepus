import type { AgentRunRecord, AgentStep } from "../agent/types";
import { getAcceptedPatchPaths } from "../agent/patch-queue";
import { saveRunArchive } from "./persist";
import type { RunArchive } from "./session-types";
import { getActiveSessionId, getWorkspaceId } from "./session-store";

const INPUT_SUMMARY_MAX = 200;
const OUTPUT_PREVIEW_MAX = 500;

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max)}…`;
}

export async function archiveCompletedRun(
  record: AgentRunRecord,
  steps: AgentStep[],
): Promise<void> {
  const workspaceId = getWorkspaceId();
  const sessionId = getActiveSessionId();
  if (!workspaceId || !sessionId) {
    return;
  }

  const archive: RunArchive = {
    runId: record.runId,
    workspaceId,
    sessionId,
    agentId: record.agentId,
    inputSummary: truncate(record.input, INPUT_SUMMARY_MAX),
    status: record.status,
    steps: steps.map((s) => ({ ...s })),
    filesTouched: getAcceptedPatchPaths(),
    outputPreview: record.output
      ? truncate(record.output, OUTPUT_PREVIEW_MAX)
      : undefined,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
  };

  try {
    await saveRunArchive(archive);
  } catch (err) {
    console.warn("run archive failed:", err);
  }
}
