import { invoke } from "@tauri-apps/api/core";

import type { AgentMode } from "../agent/mode";
import type { SessionSnapshotV2 } from "../chat/session-types";
import {
  flushSave,
  getActiveSessionId,
  getOpenSessionSummaries,
  getWorkspaceId,
  initChatSessionsForWorkspace,
  switchSession,
} from "../chat/session-store";
import { getRun } from "../agent/client";
import {
  seedSuspendedRun,
  titleFromInput,
} from "../agent/run-registry";
import { setLastAgentId, setLastRunId } from "./index";
import {
  clearSessionSnapshot,
  loadSessionSnapshot,
  type SessionSnapshot,
} from "./persist";

export type { SessionSnapshot };

export async function loadSessionSnapshotV2(): Promise<SessionSnapshotV2 | null> {
  try {
    return await invoke<SessionSnapshotV2 | null>("load_session_snapshot_v2");
  } catch {
    return null;
  }
}

export async function saveSessionSnapshotV2(
  snapshot: SessionSnapshotV2,
): Promise<void> {
  try {
    await invoke("save_session_snapshot_v2", { snapshot });
  } catch (err) {
    console.warn("session v2 persist failed:", err);
  }
}

export async function restoreSession(
  workspaceId: string,
  onStaleRun?: (runId: string, status: string) => void,
): Promise<void> {
  const v1 = await loadSessionSnapshot();
  let migrated:
    | {
        id: string;
        mode: AgentMode;
        messages: import("../chat/types").ChatMessage[];
        lastRunId?: string;
        patchQueue?: import("../agent/patch-queue").QueuedPatch[];
        title?: string;
      }
    | undefined;

  if (v1?.chatMessages?.length) {
    migrated = {
      id: "migrated-default",
      mode: (v1.lastAgentMode as AgentMode) ?? "agent",
      messages: v1.chatMessages,
      lastRunId: v1.lastRunId,
      patchQueue: v1.patchQueue,
      title: "Recovered chat",
    };
    await clearSessionSnapshot();
  }

  await initChatSessionsForWorkspace(workspaceId, migrated);

  const v2 = await loadSessionSnapshotV2();
  if (v2?.activeSessionId && v2.workspaceId === workspaceId) {
    await switchSession(v2.activeSessionId);
  }

  setLastRunId(v1?.lastRunId ?? v2?.lastRunId);
  setLastAgentId(v1?.lastAgentId);

  const runId = v1?.lastRunId ?? v2?.lastRunId;
  if (!runId) {
    return;
  }

  try {
    const run = await getRun(runId);
    if (run.status === "running" || run.status === "suspended") {
      seedSuspendedRun({
        runId,
        sessionId: getActiveSessionId() ?? "unknown",
        agentId: run.agent_id,
        status: run.status === "suspended" ? "suspended" : "running",
        startedAt: Date.now(),
        title: titleFromInput(run.input_text ?? "Recovered run"),
      });
      onStaleRun?.(runId, run.status);
      return;
    }
    setLastRunId(undefined);
  } catch {
    setLastRunId(undefined);
  }
}

export async function persistWorkspaceUiState(): Promise<void> {
  const wsId = getWorkspaceId();
  if (!wsId) {
    return;
  }
  await flushSave();
  await saveSessionSnapshotV2({
    version: 2,
    workspaceId: wsId,
    activeSessionId: getActiveSessionId() ?? undefined,
    openSessionIds: getOpenSessionSummaries().map((s) => s.id),
    savedAt: Date.now(),
  });
}
