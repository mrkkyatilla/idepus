import { invoke } from "@tauri-apps/api/core";

import type { ChatMessage } from "../chat/types";
import type { QueuedPatch } from "../agent/patch-queue";

/** @deprecated v1 — migrated to per-session chat files (G02) */
export type SessionSnapshot = {
  version: 1;
  lastRunId?: string;
  lastAgentId?: string;
  lastAgentMode?: import("../agent/mode").AgentMode;
  chatMessages: ChatMessage[];
  patchQueue: QueuedPatch[];
  savedAt: number;
};

export async function loadSessionSnapshot(): Promise<SessionSnapshot | null> {
  try {
    return await invoke<SessionSnapshot | null>("load_session_snapshot");
  } catch {
    return null;
  }
}

export async function clearSessionSnapshot(): Promise<void> {
  try {
    await invoke("clear_session_snapshot");
  } catch {
    // ignore
  }
}
