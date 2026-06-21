import { invoke } from "@tauri-apps/api/core";

import type {
  ChatSession,
  RunArchive,
  RunArchiveMeta,
  WorkspaceSessionIndex,
} from "./session-types";

export async function listChatSessions(
  workspaceId: string,
): Promise<WorkspaceSessionIndex> {
  return invoke<WorkspaceSessionIndex>("list_chat_sessions", { workspaceId });
}

export async function loadChatSession(
  workspaceId: string,
  sessionId: string,
): Promise<ChatSession | null> {
  return invoke<ChatSession | null>("load_chat_session", {
    workspaceId,
    sessionId,
  });
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  await invoke("save_chat_session", { session });
}

export async function saveWorkspaceSessionIndex(
  workspaceId: string,
  activeSessionId: string | undefined,
  openSessionIds: string[],
): Promise<void> {
  await invoke("save_workspace_session_index", {
    req: { workspaceId, activeSessionId, openSessionIds },
  });
}

export async function deleteChatSession(
  workspaceId: string,
  sessionId: string,
): Promise<void> {
  await invoke("delete_chat_session", { workspaceId, sessionId });
}

export async function saveRunArchive(archive: RunArchive): Promise<void> {
  await invoke("save_run_archive", { archive });
}

export async function listRunArchives(options?: {
  workspaceId?: string;
  limit?: number;
  offset?: number;
  days?: number;
}): Promise<RunArchiveMeta[]> {
  return invoke<RunArchiveMeta[]>("list_run_archives", {
    query: {
      workspaceId: options?.workspaceId,
      limit: options?.limit ?? 20,
      offset: options?.offset ?? 0,
      days: options?.days ?? 30,
    },
  });
}

export async function loadRunArchive(
  runId: string,
): Promise<RunArchive | null> {
  return invoke<RunArchive | null>("load_run_archive", { runId });
}

export async function deleteRunArchive(runId: string): Promise<void> {
  await invoke("delete_run_archive", { runId });
}

export async function clearWorkspaceHistory(
  workspaceId: string,
): Promise<void> {
  await invoke("clear_workspace_history", { workspaceId });
}

export async function getIdepusDataPaths(): Promise<{
  configDir: string;
  chatsDir: string;
  runsDir: string;
}> {
  return invoke("get_idepus_data_paths");
}
