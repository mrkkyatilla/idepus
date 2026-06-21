import { invoke } from "@tauri-apps/api/core";

import type { ChangeRecord, MemoryRecord } from "./types";

export async function isSemanticMemoryAvailable(): Promise<boolean> {
  return invoke<boolean>("is_semantic_memory_available");
}

export async function listMemories(workspaceId: string): Promise<MemoryRecord[]> {
  return invoke<MemoryRecord[]>("list_memories", {
    req: { workspaceId },
  });
}

export async function searchMemories(
  workspaceId: string,
  query: string,
  limit = 8,
): Promise<MemoryRecord[]> {
  return invoke<MemoryRecord[]>("search_memories", {
    req: { workspaceId, query, limit },
  });
}

export async function upsertMemories(
  workspaceId: string,
  records: MemoryRecord[],
): Promise<MemoryRecord[]> {
  return invoke<MemoryRecord[]>("upsert_memories", {
    req: { workspaceId, records },
  });
}

export async function pinMemory(
  workspaceId: string,
  memoryId: string,
): Promise<MemoryRecord> {
  return invoke<MemoryRecord>("pin_memory", {
    req: { workspaceId, memoryId },
  });
}

export async function forgetMemory(
  workspaceId: string,
  memoryId: string,
): Promise<void> {
  await invoke("forget_memory", {
    req: { workspaceId, memoryId },
  });
}

export async function indexChange(record: ChangeRecord): Promise<ChangeRecord> {
  return invoke<ChangeRecord>("index_change", { req: { record } });
}

export async function searchChanges(
  workspaceId: string,
  query: string,
  limit = 10,
): Promise<ChangeRecord[]> {
  return invoke<ChangeRecord[]>("search_changes", {
    req: { workspaceId, query, limit },
  });
}

export async function listRecentChanges(
  workspaceId: string,
  limit = 50,
): Promise<ChangeRecord[]> {
  return invoke<ChangeRecord[]>("list_recent_changes", {
    req: { workspaceId, limit },
  });
}

export async function listChangesByRun(
  workspaceId: string,
  runId: string,
): Promise<ChangeRecord[]> {
  return invoke<ChangeRecord[]>("list_changes_by_run", {
    req: { workspaceId, runId },
  });
}
