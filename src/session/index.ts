import { subscribeChatSessions } from "../chat/session-store";
import { saveAgentMode, type AgentMode } from "../agent/mode";
import { subscribePatchQueue } from "../agent/patch-queue";
import { persistWorkspaceUiState } from "./restore";

let lastRunId: string | undefined;
let lastAgentId: string | undefined;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const PERSIST_DEBOUNCE_MS = 500;

export function setLastRunId(runId: string | undefined): void {
  lastRunId = runId;
  requestPersist();
}

export function setLastAgentId(agentId: string | undefined): void {
  lastAgentId = agentId;
  requestPersist();
}

export function setLastAgentMode(mode: AgentMode): void {
  saveAgentMode(mode);
  requestPersist();
}

export function requestPersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistWorkspaceUiState();
  }, PERSIST_DEBOUNCE_MS);
}

export function getLastAgentId(): string | undefined {
  return lastAgentId;
}

export function initSessionPersistence(): void {
  subscribeChatSessions(requestPersist);
  subscribePatchQueue(requestPersist);
}

export function getLastRunId(): string | undefined {
  return lastRunId;
}
