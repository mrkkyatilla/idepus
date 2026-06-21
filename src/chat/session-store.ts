import type { AgentMode } from "../agent/mode";
import { getAgentMode, saveAgentMode } from "../agent/mode";
import { getPatchQueue, hydratePatchQueue } from "../agent/patch-queue";
import { humanizeStepLabel } from "../ui/agent/step-labels";
import type { ActivityEntry, ChatMessage } from "./types";
import {
  deleteChatSession,
  listChatSessions,
  loadChatSession,
  saveChatSession,
  saveWorkspaceSessionIndex,
} from "./persist";
import { maybeExtractMemories } from "../memory/extract";
import { takePendingContextHits } from "../memory/store";
import {
  MAX_MESSAGES_PER_SESSION,
  MAX_OPEN_TABS,
  type ChatSession,
  type SessionSummary,
} from "./session-types";

const SAVE_DEBOUNCE_MS = 500;

function newSessionId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultTitle(): string {
  return "New chat";
}

function titleFromMessages(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first?.content.trim()) {
    return defaultTitle();
  }
  const text = first.content.trim().replace(/\s+/g, " ");
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

type Listener = () => void;

let workspaceId: string | null = null;
let sessions = new Map<string, ChatSession>();
let openSessionIds: string[] = [];
let activeSessionId: string | null = null;
let composerDraft = "";
const listeners = new Set<Listener>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedFlash: (() => void) | null = null;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function activeSession(): ChatSession | null {
  if (!activeSessionId) {
    return null;
  }
  return sessions.get(activeSessionId) ?? null;
}

function trimMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_MESSAGES_PER_SESSION);
}

function buildSession(
  id: string,
  wsId: string,
  mode: AgentMode = "agent",
): ChatSession {
  const now = Date.now();
  return {
    id,
    title: defaultTitle(),
    mode,
    messages: [],
    workspaceId: wsId,
    createdAt: now,
    updatedAt: now,
  };
}

function syncSessionFromMemory(session: ChatSession): ChatSession {
  const messages = trimMessages(session.messages);
  const title =
    session.title === defaultTitle() ? titleFromMessages(messages) : session.title;
  return {
    ...session,
    messages,
    title,
    draftComposer: session.id === activeSessionId ? composerDraft : session.draftComposer,
    patchQueue:
      session.id === activeSessionId
        ? getPatchQueue().filter(
            (item) =>
              item.status === "pending" ||
              item.status === "reviewing" ||
              item.status === "staged",
          )
        : session.patchQueue,
    updatedAt: Date.now(),
  };
}

export function setSavedLocallyFlash(callback: (() => void) | null): void {
  lastSavedFlash = callback;
}

export function subscribeChatSessions(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveSessionId(): string | null {
  return activeSessionId;
}

export function getOpenSessionSummaries(): SessionSummary[] {
  return openSessionIds
    .map((id) => sessions.get(id))
    .filter((s): s is ChatSession => Boolean(s))
    .map((s) => ({
      id: s.id,
      title: s.title,
      mode: s.mode,
      updatedAt: s.updatedAt,
    }));
}

export function isSessionOpen(sessionId: string): boolean {
  return openSessionIds.includes(sessionId);
}

export function getOpenTabCount(): number {
  return openSessionIds.length;
}

export async function getWorkspaceSessionSummaries(): Promise<SessionSummary[]> {
  if (!workspaceId) {
    return [];
  }
  const index = await listChatSessions(workspaceId);
  return [...index.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function openSessionFromHistory(sessionId: string): Promise<boolean> {
  if (!workspaceId) {
    return false;
  }
  if (sessionId === activeSessionId) {
    return true;
  }
  await flushSave();

  if (sessions.has(sessionId)) {
    activeSessionId = sessionId;
    applyActiveSessionState();
    await persistIndex();
    notify();
    return true;
  }

  const loaded = await loadChatSession(workspaceId, sessionId);
  if (!loaded) {
    return false;
  }

  if (!openSessionIds.includes(sessionId)) {
    if (openSessionIds.length >= MAX_OPEN_TABS) {
      const evict = openSessionIds.find((id) => id !== activeSessionId) ?? openSessionIds[0];
      openSessionIds = openSessionIds.filter((id) => id !== evict);
      sessions.delete(evict);
    }
    openSessionIds.push(sessionId);
  }

  sessions.set(loaded.id, loaded);
  activeSessionId = sessionId;
  applyActiveSessionState();
  await persistIndex();
  notify();
  return true;
}

export function getActiveSession(): ChatSession | null {
  return activeSession();
}

export function getComposerDraft(): string {
  return composerDraft;
}

export function setComposerDraft(text: string): void {
  composerDraft = text;
  scheduleSave();
}

export async function initChatSessionsForWorkspace(
  wsId: string,
  migratedSession?: Partial<ChatSession>,
): Promise<void> {
  if (!migratedSession && workspaceId === wsId && sessions.size > 0) {
    return;
  }

  if (workspaceId && workspaceId !== wsId) {
    await flushSave();
  }

  workspaceId = wsId;
  sessions.clear();
  openSessionIds = [];
  activeSessionId = null;
  composerDraft = "";

  const index = await listChatSessions(wsId);

  if (migratedSession?.id && migratedSession.messages) {
    const session = buildSession(migratedSession.id, wsId, migratedSession.mode ?? "agent");
    session.messages = trimMessages(migratedSession.messages);
    session.title = migratedSession.title ?? titleFromMessages(session.messages);
    session.lastRunId = migratedSession.lastRunId;
    session.activePlanId = migratedSession.activePlanId;
    session.patchQueue = migratedSession.patchQueue;
    sessions.set(session.id, session);
    openSessionIds = [session.id];
    activeSessionId = session.id;
    await saveChatSession(syncSessionFromMemory(session));
  } else if (index.sessions.length > 0) {
    const toOpen =
      index.openSessionIds.length > 0
        ? index.openSessionIds.slice(0, MAX_OPEN_TABS)
        : index.sessions.slice(0, 1).map((s) => s.id);

    for (const sid of toOpen) {
      const loaded = await loadChatSession(wsId, sid);
      if (loaded) {
        sessions.set(loaded.id, loaded);
        openSessionIds.push(loaded.id);
      }
    }

    activeSessionId =
      index.activeSessionId && sessions.has(index.activeSessionId)
        ? index.activeSessionId
        : openSessionIds[0] ?? null;
  }

  if (sessions.size === 0) {
    const session = buildSession(newSessionId(), wsId, getAgentMode());
    sessions.set(session.id, session);
    openSessionIds = [session.id];
    activeSessionId = session.id;
    await saveChatSession(session);
  }

  applyActiveSessionState();
  notify();
}

function applyActiveSessionState(): void {
  const session = activeSession();
  if (!session) {
    return;
  }
  saveAgentMode(session.mode);
  composerDraft = session.draftComposer ?? "";
  hydratePatchQueue(session.patchQueue ?? []);
}

export async function switchSession(sessionId: string): Promise<boolean> {
  if (sessionId === activeSessionId) {
    return true;
  }
  if (!sessions.has(sessionId)) {
    return false;
  }
  await flushSave();
  activeSessionId = sessionId;
  applyActiveSessionState();
  await persistIndex();
  notify();
  return true;
}

export async function createSession(mode?: AgentMode): Promise<string> {
  if (!workspaceId) {
    throw new Error("No workspace loaded");
  }
  if (openSessionIds.length >= MAX_OPEN_TABS) {
    throw new Error(`Maximum ${MAX_OPEN_TABS} chat tabs open`);
  }
  await flushSave();
  const session = buildSession(newSessionId(), workspaceId, mode ?? getAgentMode());
  sessions.set(session.id, session);
  openSessionIds.push(session.id);
  activeSessionId = session.id;
  composerDraft = "";
  hydratePatchQueue([]);
  await saveChatSession(session);
  await persistIndex();
  notify();
  return session.id;
}

export async function closeSession(
  sessionId: string,
): Promise<ChatSession | null> {
  if (!workspaceId || !sessions.has(sessionId)) {
    return null;
  }
  if (openSessionIds.length <= 1) {
    return null;
  }

  await flushSave();
  const removed = sessions.get(sessionId) ?? null;
  sessions.delete(sessionId);
  openSessionIds = openSessionIds.filter((id) => id !== sessionId);

  if (activeSessionId === sessionId) {
    activeSessionId = openSessionIds[openSessionIds.length - 1] ?? null;
    applyActiveSessionState();
  }

  await deleteChatSession(workspaceId, sessionId);
  await persistIndex();
  notify();
  return removed;
}

/** Permanently delete a chat from disk (open tab or history-only). */
export async function deleteSessionPermanently(
  sessionId: string,
): Promise<boolean> {
  if (!workspaceId) {
    return false;
  }
  const isOpen = sessions.has(sessionId);
  if (isOpen && openSessionIds.length <= 1) {
    return false;
  }

  if (isOpen) {
    await flushSave();
    sessions.delete(sessionId);
    openSessionIds = openSessionIds.filter((id) => id !== sessionId);
    if (activeSessionId === sessionId) {
      activeSessionId = openSessionIds[openSessionIds.length - 1] ?? null;
      applyActiveSessionState();
    }
  }

  await deleteChatSession(workspaceId, sessionId);
  await persistIndex();
  notify();
  return true;
}

export async function restoreClosedSession(session: ChatSession): Promise<void> {
  if (!workspaceId) {
    return;
  }
  if (openSessionIds.length >= MAX_OPEN_TABS) {
    return;
  }
  sessions.set(session.id, session);
  if (!openSessionIds.includes(session.id)) {
    openSessionIds.push(session.id);
  }
  await saveChatSession(syncSessionFromMemory(session));
  activeSessionId = session.id;
  applyActiveSessionState();
  await persistIndex();
  notify();
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }
  session.title = title.trim() || defaultTitle();
  session.updatedAt = Date.now();
  scheduleSave();
  notify();
}

export function updateActiveSessionMode(mode: AgentMode): void {
  const session = activeSession();
  if (!session) {
    return;
  }
  session.mode = mode;
  session.updatedAt = Date.now();
  scheduleSave();
  notify();
}

export function updateActiveSessionLastRunId(runId: string | undefined): void {
  const session = activeSession();
  if (!session) {
    return;
  }
  session.lastRunId = runId;
  session.updatedAt = Date.now();
  scheduleSave();
}

export function updateActiveSessionSummary(summary: string | undefined): void {
  const session = activeSession();
  if (!session) {
    return;
  }
  const trimmed = summary?.trim();
  session.sessionSummary = trimmed ? trimmed.slice(0, 500) : undefined;
  session.updatedAt = Date.now();
  scheduleSave();
  notify();
}

export async function setActivePlanId(
  sessionId: string,
  planId: string | undefined,
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }
  session.activePlanId = planId;
  session.updatedAt = Date.now();
  if (sessionId === activeSessionId) {
    scheduleSave();
  } else {
    await saveChatSession(syncSessionFromMemory(session));
  }
  notify();
}

// --- Chat message API (facade for active session) ---

export function getChatMessages(): ChatMessage[] {
  return [...(activeSession()?.messages ?? [])];
}

let activeStreamId: string | null = null;
const streamByRunId = new Map<string, string>();

function findSessionForStream(streamId: string): ChatSession | null {
  for (const session of sessions.values()) {
    if (session.messages.some((m) => m.id === streamId)) {
      return session;
    }
  }
  return null;
}

export function bindStreamToRun(runId: string, messageId: string): void {
  streamByRunId.set(runId, messageId);
}

function updateMessageForRun(
  runId: string,
  updater: (msg: ChatMessage) => ChatMessage,
): void {
  const streamId = streamByRunId.get(runId) ?? activeStreamId;
  if (!streamId) {
    return;
  }
  const session = findSessionForStream(streamId);
  if (!session) {
    return;
  }
  session.messages = session.messages.map((msg) =>
    msg.id === streamId ? updater(msg) : msg,
  );
  session.updatedAt = Date.now();
  if (session.id === activeSessionId) {
    notify();
  } else {
    scheduleSave();
  }
}

/** Plan mode: show a lightweight running banner in chat (not markdown output). */
export function initPlanRunActivity(runId: string): void {
  updateMessageForRun(runId, (msg) => ({
    ...msg,
    activity: [
      {
        id: "act-plan-intro",
        label: "Exploring codebase and drafting plan",
        status: "running",
      },
    ],
  }));
}

/** Plan mode: record a completed graph step with a checkmark in the activity feed. */
const NEXT_PLAN_NODE: Record<string, string> = {
  gather_context: "explore_loop",
  explore_loop: "think_briefly",
  research: "think_briefly",
  think_briefly: "propose_plan",
  propose_plan: "write_plan",
};

export function recordPlanStepActivity(runId: string, rawLabel: string): void {
  const label = humanizeStepLabel(rawLabel);
  const nextNode = NEXT_PLAN_NODE[rawLabel.trim().toLowerCase()];
  updateMessageForRun(runId, (msg) => {
    let activity = [...(msg.activity ?? [])];
    activity = activity.map((entry) =>
      entry.status === "running" ? { ...entry, status: "done" as const } : entry,
    );
    const last = activity[activity.length - 1];
    if (!(last?.label === label && last.status === "done")) {
      activity.push({
        id: `act-${activity.length}-${Date.now()}`,
        label,
        status: "done",
      });
    }
    if (nextNode) {
      const nextLabel = humanizeStepLabel(nextNode);
      const tail = activity[activity.length - 1];
      if (!(tail?.label === nextLabel && tail.status === "running")) {
        activity.push({
          id: `act-next-${Date.now()}`,
          label: nextLabel,
          status: "running",
        });
      }
    }
    return { ...msg, activity };
  });
}

/** Agent mode: light activity when a patch is queued during batch defer. */
export function recordPatchQueuedActivity(runId: string, patchPath: string): void {
  const fileName = patchPath.split(/[/\\]/).pop() ?? patchPath;
  const label = `Patch queued: ${fileName}`;
  updateMessageForRun(runId, (msg) => {
    const activity = [...(msg.activity ?? [])];
    const last = activity[activity.length - 1];
    if (last?.label === label && last.status === "done") {
      return msg;
    }
    activity.push({
      id: `patch-${Date.now()}`,
      label,
      status: "done",
    });
    return { ...msg, activity };
  });
}

/** Plan mode: show that the run ended without a usable plan. */
export function recordPlanActivityError(runId: string, message: string): void {
  updateMessageForRun(runId, (msg) => {
    let activity = [...(msg.activity ?? [])];
    activity = activity.map((entry) =>
      entry.status === "running" ? { ...entry, status: "error" as const } : entry,
    );
    activity.push({
      id: `act-err-${Date.now()}`,
      label: message,
      status: "error",
    });
    return { ...msg, activity };
  });
}

/** Mark any in-progress plan activity lines as completed when the run ends. */
export function finalizePlanRunActivity(runId: string): void {
  updateMessageForRun(runId, (msg) => {
    if (!msg.activity?.length) {
      return msg;
    }
    return {
      ...msg,
      activity: msg.activity.map((entry) =>
        entry.status === "running" ? { ...entry, status: "done" as const } : entry,
      ),
    };
  });
}

export function appendAssistantTokenForRun(runId: string, text: string): void {
  if (!text) {
    return;
  }
  const streamId = streamByRunId.get(runId) ?? activeStreamId;
  if (!streamId) {
    return;
  }
  const session = findSessionForStream(streamId);
  if (!session) {
    return;
  }
  session.messages = session.messages.map((msg) =>
    msg.id === streamId
      ? { ...msg, content: (msg.content + text).slice(-12000) }
      : msg,
  );
  if (session.id === activeSessionId) {
    notify();
  } else {
    scheduleSave();
  }
}

export function finalizeAssistantStreamForRun(
  runId: string,
  content?: string,
): void {
  const streamId = streamByRunId.get(runId) ?? activeStreamId;
  if (!streamId) {
    return;
  }
  streamByRunId.delete(runId);
  if (activeStreamId === streamId) {
    activeStreamId = null;
  }
  const session = findSessionForStream(streamId);
  if (!session) {
    return;
  }
  session.messages = session.messages.map((msg) =>
    msg.id === streamId
      ? { ...msg, content: content ?? msg.content, streaming: false }
      : msg,
  );
  session.updatedAt = Date.now();
  scheduleSave();
  notify();
}

export function addUserMessage(content: string, runId?: string): string {
  const session = activeSession();
  if (!session) {
    return "";
  }
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  session.messages = trimMessages([
    ...session.messages,
    { id, role: "user", content, runId, createdAt: Date.now() },
  ]);
  session.title = titleFromMessages(session.messages);
  session.updatedAt = Date.now();
  scheduleSave();
  notify();
  return id;
}

export function startAssistantStream(runId: string): string {
  const session = activeSession();
  if (!session) {
    return "";
  }
  if (activeStreamId) {
    finalizeAssistantStream();
  }
  const id = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  activeStreamId = id;
  const hits = takePendingContextHits();
  const contextHits =
    hits && (hits.memories?.length || hits.changes?.length) ? hits : undefined;
  session.messages = trimMessages([
    ...session.messages,
    {
      id,
      role: "assistant",
      content: "",
      runId,
      streaming: true,
      createdAt: Date.now(),
      contextHits,
    },
  ]);
  session.updatedAt = Date.now();
  scheduleSave();
  notify();
  bindStreamToRun(runId, id);
  return id;
}

export function appendAssistantToken(text: string): void {
  if (!activeStreamId || !text) {
    return;
  }
  const session = activeSession();
  if (!session) {
    return;
  }
  session.messages = session.messages.map((msg) =>
    msg.id === activeStreamId
      ? { ...msg, content: (msg.content + text).slice(-12000) }
      : msg,
  );
  notify();
}

export function finalizeAssistantStream(content?: string): void {
  if (!activeStreamId) {
    return;
  }
  const streamId = activeStreamId;
  activeStreamId = null;
  const session = activeSession();
  if (!session) {
    return;
  }
  session.messages = session.messages.map((msg) =>
    msg.id === streamId
      ? { ...msg, content: content ?? msg.content, streaming: false }
      : msg,
  );
  session.updatedAt = Date.now();
  scheduleSave();
  notify();
}

/** Replace the latest assistant bubble (e.g. after plan sync to Plan panel). */
export function shortenLastAssistantMessage(summary: string): void {
  const session = activeSession();
  if (!session || !summary.trim()) {
    return;
  }
  const lastAssistant = [...session.messages]
    .reverse()
    .find((m) => m.role === "assistant");
  if (!lastAssistant) {
    return;
  }
  shortenAssistantMessageById(lastAssistant.id, summary);
}

/** Target a specific assistant message (avoids races with new implement streams). */
export function shortenAssistantMessageByRunId(runId: string, summary: string): void {
  const session = activeSession();
  if (!session || !summary.trim()) {
    return;
  }
  const streamId = streamByRunId.get(runId);
  if (streamId) {
    shortenAssistantMessageById(streamId, summary);
    return;
  }
  const byRun = [...session.messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.runId === runId);
  if (byRun) {
    shortenAssistantMessageById(byRun.id, summary);
  }
}

export function shortenAssistantMessageById(messageId: string, summary: string): void {
  const session = activeSession();
  if (!session || !summary.trim()) {
    return;
  }
  session.messages = session.messages.map((msg) =>
    msg.id === messageId
      ? { ...msg, content: summary.trim(), streaming: false }
      : msg,
  );
  if (activeStreamId === messageId) {
    activeStreamId = null;
  }
  session.updatedAt = Date.now();
  scheduleSave();
  notify();
}

export function addAssistantMessage(content: string, runId?: string): void {
  if (activeStreamId) {
    finalizeAssistantStream(content);
    return;
  }
  const session = activeSession();
  if (!session) {
    return;
  }
  session.messages = trimMessages([
    ...session.messages,
    {
      id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: "assistant",
      content,
      runId,
      createdAt: Date.now(),
    },
  ]);
  session.updatedAt = Date.now();
  scheduleSave();
  notify();
}

export function hydrateChatMessages(next: ChatMessage[]): void {
  const session = activeSession();
  if (!session) {
    return;
  }
  session.messages = trimMessages(next);
  activeStreamId = null;
  session.updatedAt = Date.now();
  notify();
}

export function scheduleSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushSave();
  }, SAVE_DEBOUNCE_MS);
}

export async function flushSave(): Promise<void> {
  if (!workspaceId || !activeSessionId) {
    return;
  }
  const session = sessions.get(activeSessionId);
  if (!session) {
    return;
  }
  const payload = syncSessionFromMemory(session);
  sessions.set(activeSessionId, payload);
  try {
    await saveChatSession(payload);
    await persistIndex();
    lastSavedFlash?.();
    if (workspaceId && activeSessionId) {
      void maybeExtractMemories(workspaceId, activeSessionId);
    }
  } catch (err) {
    console.warn("chat session save failed:", err);
  }
}

async function persistIndex(): Promise<void> {
  if (!workspaceId) {
    return;
  }
  await saveWorkspaceSessionIndex(workspaceId, activeSessionId ?? undefined, openSessionIds);
}

export function getWorkspaceId(): string | null {
  return workspaceId;
}
