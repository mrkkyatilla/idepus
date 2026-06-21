import type { ChatMessage } from "../chat/types";
import type { ContextHits, MemoryRecord } from "./types";
import { MEMORY_TOKEN_BUDGET_RATIO } from "./types";
import { searchMemoryAndChanges } from "./store";
import { trackMemoryRetrieval } from "./telemetry";

const WORKING_MESSAGE_LIMIT = 8;
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function formatMemoryBlock(memories: MemoryRecord[]): string {
  if (memories.length === 0) {
    return "";
  }
  const lines = memories.map((m) => {
    const refs = m.refs.length > 0 ? ` (refs: ${m.refs.join(", ")})` : "";
    return `- [${m.type}] ${m.text}${refs}`;
  });
  return `[Retrieved memories]\n${lines.join("\n")}`;
}

function formatChangeBlock(
  changes: Array<{ path: string; summary: string }>,
): string {
  if (changes.length === 0) {
    return "";
  }
  const lines = changes.map((c) => `- ${c.path}: ${c.summary}`);
  return `[Recent changes]\n${lines.join("\n")}`;
}

function formatSessionSummary(summary?: string): string {
  if (!summary?.trim()) {
    return "";
  }
  return `[Session summary]\n${summary.trim()}`;
}

export type MemoryComposeResult = {
  block: string;
  hits: ContextHits;
};

export async function buildMemoryContext(
  userInput: string,
  workspaceId: string | undefined,
  options?: {
    sessionSummary?: string;
    totalBudgetTokens?: number;
  },
): Promise<MemoryComposeResult> {
  const empty: MemoryComposeResult = { block: "", hits: {} };
  if (!workspaceId || !userInput.trim()) {
    return empty;
  }

  const hits = await searchMemoryAndChanges(workspaceId, userInput, {
    includeChanges: true,
  });

  const budget = Math.floor(
    (options?.totalBudgetTokens ?? 4000) * MEMORY_TOKEN_BUDGET_RATIO,
  );
  const parts: string[] = [];
  let used = 0;

  const summaryPart = formatSessionSummary(options?.sessionSummary);
  if (summaryPart) {
    used += estimateTokens(summaryPart);
    parts.push(summaryPart);
  }

  if (hits.memories && hits.memories.length > 0) {
    const fullRecords: MemoryRecord[] = hits.memories.map((m) => ({
      id: m.id,
      sessionId: "",
      workspaceId,
      type: m.type,
      text: m.text,
      refs: [],
      createdAt: 0,
      pinned: false,
    }));
    const memBlock = formatMemoryBlock(fullRecords);
    const tokens = estimateTokens(memBlock);
    if (used + tokens <= budget) {
      parts.push(memBlock);
      used += tokens;
    }
  }

  if (hits.changes && hits.changes.length > 0) {
    const chBlock = formatChangeBlock(hits.changes);
    const tokens = estimateTokens(chBlock);
    if (used + tokens <= budget) {
      parts.push(chBlock);
      used += tokens;
    }
  }

  trackMemoryRetrieval(hits);

  if (parts.length === 0) {
    return { block: "", hits };
  }

  return {
    block: `${parts.join("\n\n")}\n\n`,
    hits,
  };
}

export function formatWorkingMessages(messages: ChatMessage[]): string {
  const recent = messages.slice(-WORKING_MESSAGE_LIMIT);
  if (recent.length === 0) {
    return "";
  }
  const lines = recent.map((m) => `${m.role}: ${m.content.slice(0, 500)}`);
  return `[Recent conversation]\n${lines.join("\n")}`;
}
