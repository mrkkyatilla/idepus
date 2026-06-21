import type { AgentMode } from "../agent/mode";
import type { AgentStep } from "../agent/types";
import type { ChatMessage } from "./types";
import type { QueuedPatch } from "../agent/patch-queue";

export type ChatSession = {
  id: string;
  title: string;
  mode: AgentMode;
  messages: ChatMessage[];
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
  lastRunId?: string;
  activePlanId?: string;
  draftComposer?: string;
  patchQueue?: QueuedPatch[];
  sessionSummary?: string;
};

export type SessionSummary = Pick<
  ChatSession,
  "id" | "title" | "mode" | "updatedAt"
>;

export type WorkspaceSessionIndex = {
  workspaceId: string;
  sessions: SessionSummary[];
  activeSessionId?: string;
  openSessionIds: string[];
};

export type RunArchive = {
  runId: string;
  workspaceId: string;
  sessionId: string;
  agentId: string;
  inputSummary: string;
  status: string;
  steps: AgentStep[];
  filesTouched: string[];
  outputPreview?: string;
  startedAt: number;
  endedAt?: number;
};

export type RunArchiveMeta = Omit<
  RunArchive,
  "steps" | "filesTouched" | "outputPreview"
>;

export type SessionSnapshotV2 = {
  version: 2;
  workspaceId?: string;
  activeSessionId?: string;
  openSessionIds: string[];
  lastRunId?: string;
  savedAt: number;
};

export const MAX_OPEN_TABS = 10;
export const MAX_MESSAGES_PER_SESSION = 50;
