import { getChatMessages } from "../chat/session-store";
import type { MemoryRecord, MemoryType } from "./types";
import { upsertMemories } from "./persist";

const EXTRACT_EVERY_USER_MESSAGES = 10;
let lastExtractCount = 0;
let extractInFlight = false;

export async function maybeExtractMemories(
  workspaceId: string,
  sessionId: string,
): Promise<void> {
  if (extractInFlight) {
    return;
  }

  const messages = getChatMessages();
  const userCount = messages.filter((m) => m.role === "user").length;
  if (userCount < EXTRACT_EVERY_USER_MESSAGES) {
    return;
  }
  if (userCount - lastExtractCount < EXTRACT_EVERY_USER_MESSAGES) {
    return;
  }

  extractInFlight = true;
  try {
    const records = heuristicExtract(messages, workspaceId, sessionId);
    if (records.length > 0) {
      await upsertMemories(workspaceId, records);
      lastExtractCount = userCount;
    }
  } catch (err) {
    console.warn("memory extract failed:", err);
  } finally {
    extractInFlight = false;
  }
}

function heuristicExtract(
  messages: ReturnType<typeof getChatMessages>,
  workspaceId: string,
  sessionId: string,
): MemoryRecord[] {
  const now = Date.now();
  const records: MemoryRecord[] = [];
  const transcript = messages
    .slice(-30)
    .map((m) => m.content)
    .join("\n");

  const patterns: Array<{ re: RegExp; type: MemoryType }> = [
    { re: /(?:decided|karar verildi|we will|let's use|going to use)\s+(.{10,120})/gi, type: "decision" },
    { re: /(?:prefer|tercih|always use)\s+(.{8,100})/gi, type: "preference" },
    { re: /(?:fact:|note:)\s+(.{8,120})/gi, type: "fact" },
  ];

  for (const { re, type } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(transcript)) !== null && records.length < 5) {
      records.push({
        id: "",
        sessionId,
        workspaceId,
        type,
        text: match[1]!.trim(),
        refs: [],
        createdAt: now,
        pinned: false,
      });
    }
  }

  const fileRef = transcript.match(/`([^`]+\.[a-z]{1,4})`/gi);
  if (fileRef) {
    for (const raw of fileRef.slice(0, 3)) {
      const path = raw.replace(/`/g, "");
      records.push({
        id: "",
        sessionId,
        workspaceId,
        type: "file_ref",
        text: `Referenced file ${path}`,
        refs: [path],
        createdAt: now,
        pinned: false,
      });
    }
  }

  return records;
}

export function resetExtractThrottle(): void {
  lastExtractCount = 0;
}
