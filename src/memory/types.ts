export type MemoryType = "fact" | "decision" | "preference" | "file_ref";

export type MemoryRecord = {
  id: string;
  sessionId: string;
  workspaceId: string;
  type: MemoryType;
  text: string;
  refs: string[];
  createdAt: number;
  pinned: boolean;
};

export type ChangeRecord = {
  id: string;
  workspaceId: string;
  runId: string;
  sessionId?: string;
  path: string;
  summary: string;
  diffExcerpt: string;
  acceptedAt: number;
};

export type ContextHitMemory = {
  id: string;
  type: MemoryType;
  text: string;
};

export type ContextHitChange = {
  id: string;
  path: string;
  summary: string;
};

export type ContextHits = {
  memories?: ContextHitMemory[];
  changes?: ContextHitChange[];
};

export const MEMORY_TOKEN_BUDGET_RATIO = 0.2;
export const MAX_DIFF_EXCERPT = 2048;
