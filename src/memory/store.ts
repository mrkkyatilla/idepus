import type { ContextHits, MemoryRecord } from "./types";
import {
  forgetMemory,
  listMemories,
  pinMemory,
  searchChanges,
  searchMemories,
} from "./persist";

type Listener = () => void;

let lastRetrieval: ContextHits | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    l();
  }
}

export function subscribeMemoryStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLastRetrieval(): ContextHits | null {
  return lastRetrieval;
}

export function setPendingContextHits(hits: import("./types").ContextHits | null): void {
  lastRetrieval = hits;
  notify();
}

export function takePendingContextHits(): import("./types").ContextHits | null {
  const hits = lastRetrieval;
  return hits;
}

export async function fetchMemories(workspaceId: string): Promise<MemoryRecord[]> {
  return listMemories(workspaceId);
}

export async function pinMemoryRecord(
  workspaceId: string,
  memoryId: string,
): Promise<void> {
  await pinMemory(workspaceId, memoryId);
  notify();
}

export async function forgetMemoryRecord(
  workspaceId: string,
  memoryId: string,
): Promise<void> {
  await forgetMemory(workspaceId, memoryId);
  notify();
}

export async function searchMemoryAndChanges(
  workspaceId: string,
  query: string,
  options?: { includeChanges?: boolean },
): Promise<ContextHits> {
  const [memories, changes] = await Promise.all([
    searchMemories(workspaceId, query, 8),
    options?.includeChanges !== false && shouldSearchChanges(query)
      ? searchChanges(workspaceId, query, 5)
      : Promise.resolve([]),
  ]);

  const hits: ContextHits = {
    memories: memories.map((m) => ({
      id: m.id,
      type: m.type,
      text: m.text,
    })),
    changes:
      changes.length > 0
        ? changes.map((c) => ({
            id: c.id,
            path: c.path,
            summary: c.summary,
          }))
        : undefined,
  };
  setPendingContextHits(hits);
  return hits;
}

function shouldSearchChanges(query: string): boolean {
  const lower = query.toLowerCase();
  return /değiştir|changed|refactor|patch|dosya|file|auth|fix|update|geçen|last|önceki|previous/.test(
    lower,
  );
}

export function isMemoryDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    new URLSearchParams(window.location.search).has("debug") &&
    new URLSearchParams(window.location.search).get("debug") === "memory"
  );
}
