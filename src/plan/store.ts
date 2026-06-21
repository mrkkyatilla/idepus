import {
  getActiveSession,
  getActiveSessionId,
  setActivePlanId as persistActivePlanId,
  subscribeChatSessions,
} from "../chat/session-store";
import { readPlan, updatePlanStatus, writePlan, listPlans } from "./persist";
import type { PlanDocument, PlanMeta } from "./types";

const APPROVAL_KEY = "idepus.plan.requireApproval";

let activePlanId: string | null = null;
let activeDocument: PlanDocument | null = null;
let dirty = false;
let unsavedDraft = false;
let planSaveError: string | null = null;
const appliedPlanRunIds = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribePlanStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActivePlanId(): string | null {
  return activePlanId;
}

export function getActivePlanDocument(): PlanDocument | null {
  return activeDocument;
}

export function isPlanDirty(): boolean {
  return dirty;
}

export function isPlanUnsavedDraft(): boolean {
  return unsavedDraft;
}

export function getPlanSaveError(): string | null {
  return planSaveError;
}

export function getLastPlanRunError(): string | null {
  return planSaveError;
}

/** Clear the in-panel plan editor (e.g. before a new plan run). */
export function clearActivePlan(): void {
  activePlanId = null;
  activeDocument = null;
  dirty = false;
  unsavedDraft = false;
  planSaveError = null;
  const sessionId = getActiveSessionId();
  if (sessionId) {
    void persistActivePlanId(sessionId, undefined);
  }
  notify();
}

export function planApprovalRequired(): boolean {
  if (typeof localStorage === "undefined") {
    return true;
  }
  const raw = localStorage.getItem(APPROVAL_KEY);
  if (raw === null) {
    return true;
  }
  return raw !== "0" && raw !== "false";
}

export function setPlanEditorContent(content: string): void {
  if (!activeDocument) {
    return;
  }
  activeDocument = { ...activeDocument, content };
  dirty = true;
  notify();
}

export async function loadPlan(planId: string): Promise<PlanDocument> {
  const doc = await readPlan(planId);
  activePlanId = planId;
  activeDocument = doc;
  dirty = false;
  unsavedDraft = false;
  planSaveError = null;
  const sessionId = getActiveSessionId();
  if (sessionId) {
    await persistActivePlanId(sessionId, planId);
  }
  notify();
  return doc;
}

export async function bindPlanToSession(sessionId: string): Promise<void> {
  const session = getActiveSession();
  if (!session || session.id !== sessionId) {
    return;
  }
  const planId = session.activePlanId;
  if (!planId) {
    activePlanId = null;
    activeDocument = null;
    dirty = false;
    unsavedDraft = false;
    planSaveError = null;
    notify();
    return;
  }
  if (planId === activePlanId && activeDocument) {
    return;
  }
  try {
    await loadPlan(planId);
  } catch {
    activePlanId = null;
    activeDocument = null;
    dirty = false;
    notify();
  }
}

export function loadPlanDraft(
  title: string,
  content: string,
  saveError?: string,
): void {
  const now = Date.now();
  const draftId = `draft-${now}`;
  activePlanId = draftId;
  activeDocument = {
    meta: {
      id: draftId,
      path: ".idepus/plans/(unsaved)",
      title: title || "Plan draft",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    },
    content,
  };
  dirty = true;
  unsavedDraft = true;
  planSaveError = saveError ?? null;
  notify();
}

export function extractPlanMarkdown(
  text: string,
): { title: string; content: string } | null {
  const start = text.indexOf("# Plan:");
  if (start < 0 || !text.includes("## ")) {
    return null;
  }
  const content = text.slice(start);
  const titleLine = content.split("\n")[0] ?? "";
  const title =
    titleLine.replace(/^#\s*Plan:\s*/i, "").trim() || "Plan draft";
  return { title, content };
}

export async function notifyPlanDraftFromText(
  text: string,
  saveError?: string,
): Promise<void> {
  if (activeDocument && !unsavedDraft && activePlanId && !activePlanId.startsWith("draft-")) {
    return;
  }
  const extracted = extractPlanMarkdown(text);
  if (!extracted) {
    if (saveError) {
      planSaveError = saveError;
      notify();
    }
    return;
  }
  loadPlanDraft(extracted.title, extracted.content, saveError);
}

export async function saveActivePlan(): Promise<PlanMeta | null> {
  if (!activeDocument) {
    return null;
  }
  if (unsavedDraft || !activePlanId || activePlanId.startsWith("draft-")) {
    const { writePlanFile } = await import("./persist");
    const doc = await writePlanFile({
      title: activeDocument.meta.title,
      content: activeDocument.content,
      runId: activeDocument.meta.runId,
      sessionId: getActiveSessionId() ?? undefined,
    });
    activePlanId = doc.meta.id;
    activeDocument = doc;
    dirty = false;
    unsavedDraft = false;
    planSaveError = null;
    const sessionId = getActiveSessionId();
    if (sessionId) {
      await persistActivePlanId(sessionId, doc.meta.id);
    }
    notify();
    return doc.meta;
  }
  if (!activePlanId) {
    return null;
  }
  const meta = await writePlan({
    planId: activePlanId,
    content: activeDocument.content,
    title: activeDocument.meta.title,
    status: "draft",
  });
  activeDocument = { ...activeDocument, meta };
  dirty = false;
  unsavedDraft = false;
  planSaveError = null;
  notify();
  return meta;
}

export async function approveActivePlan(): Promise<PlanMeta | null> {
  if (!activePlanId || !activeDocument) {
    return null;
  }
  if (dirty || isPlanUnsavedDraft()) {
    await saveActivePlan();
  }
  if (!activePlanId || !activeDocument) {
    return null;
  }
  if (
    activeDocument.meta.status === "approved" ||
    activeDocument.meta.status === "implementing"
  ) {
    return activeDocument.meta;
  }
  const meta = await updatePlanStatus({
    planId: activePlanId,
    status: "approved",
  });
  activeDocument = { ...activeDocument, meta };
  notify();
  return meta;
}

/** Save draft/dirty state and approve when required before implement. */
export async function ensurePlanReadyForImplement(): Promise<boolean> {
  if (!activeDocument) {
    return false;
  }
  try {
    if (!planApprovalRequired()) {
      if (dirty || isPlanUnsavedDraft()) {
        try {
          await saveActivePlan();
        } catch {
          // In-memory plan content is enough to launch implement.
        }
      }
      return Boolean(getActivePlanDocument());
    }
    if (dirty || isPlanUnsavedDraft()) {
      await saveActivePlan();
    }
    if (!activePlanId || !activeDocument) {
      return false;
    }
    if (
      activeDocument.meta.status === "approved" ||
      activeDocument.meta.status === "implementing"
    ) {
      return true;
    }
    if (activeDocument.meta.status === "draft") {
      await approveActivePlan();
      return getActivePlanDocument()?.meta.status === "approved";
    }
    return false;
  } catch {
    return false;
  }
}

export async function markPlanImplementing(
  planId: string,
  implementRunId?: string,
): Promise<void> {
  const meta = await updatePlanStatus({
    planId,
    status: "implementing",
    implementRunId,
  });
  if (activePlanId === planId && activeDocument) {
    activeDocument = { ...activeDocument, meta };
    notify();
  }
}

export async function rejectActivePlan(): Promise<void> {
  if (!activePlanId) {
    return;
  }
  if (!unsavedDraft && !activePlanId.startsWith("draft-")) {
    await updatePlanStatus({ planId: activePlanId, status: "draft" });
  }
  activePlanId = null;
  activeDocument = null;
  dirty = false;
  unsavedDraft = false;
  planSaveError = null;
  const sessionId = getActiveSessionId();
  if (sessionId) {
    await persistActivePlanId(sessionId, undefined);
  }
  notify();
}

export async function notifyPlanWritten(planId: string): Promise<void> {
  await loadPlan(planId);
}

/** Load plan file written during a run (by runId on PlanMeta). */
export async function syncPlanFromRun(runId: string): Promise<boolean> {
  if (!runId.trim()) {
    return false;
  }
  try {
    const plans = await listPlans();
    const match = plans
      .filter((p) => p.runId === runId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!match) {
      return false;
    }
    await loadPlan(match.id);
    summarizePlanInChat(match.title, runId);
    return true;
  } catch {
    return false;
  }
}

/** After a plan run: prefer disk sync, else parse markdown from assistant output. */
export async function applyPlanRunOutput(
  runId: string,
  output: string,
): Promise<boolean> {
  if (appliedPlanRunIds.has(runId)) {
    return Boolean(getActivePlanDocument());
  }
  if (await syncPlanFromRun(runId)) {
    appliedPlanRunIds.add(runId);
    return true;
  }
  const extracted = extractPlanMarkdown(output);
  if (extracted) {
    await notifyPlanDraftFromText(output);
    summarizePlanInChat(extracted.title, runId);
    appliedPlanRunIds.add(runId);
    return true;
  }
  planSaveError =
    "Plan run finished but no plan was saved. Try again or use Agent mode for direct edits.";
  notify();
  appliedPlanRunIds.add(runId);
  return false;
}

function summarizePlanInChat(title: string, runId?: string): void {
  void import("../chat/session-store").then(
    ({ shortenAssistantMessageByRunId, shortenLastAssistantMessage }) => {
      const summary = `Plan **${title}** is in the Plan panel. Review it, then click **Implement** to apply the changes.`;
      if (runId) {
        shortenAssistantMessageByRunId(runId, summary);
      } else {
        shortenLastAssistantMessage(summary);
      }
    },
  );
}

export async function restoreLatestPlanForWorkspace(): Promise<void> {
  const session = getActiveSession();
  if (session?.activePlanId) {
    await bindPlanToSession(session.id);
    return;
  }
  clearActivePlan();
}

export function extractPlanReferences(planMarkdown: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  const refSection = planMarkdown.match(/## References\s*\n([\s\S]*?)(?:\n## |\n# |$)/i);
  const body = refSection?.[1] ?? planMarkdown;
  for (const line of body.split("\n")) {
    const bullet = line.match(/^-\s+(.+)/);
    if (!bullet) {
      continue;
    }
    const raw = bullet[1]!.trim();
    const pathMatch = raw.match(
      /^[`"]?([^\s`"(]+(?:\/[^\s`"(]+)*\.[a-z0-9]{1,8})/i,
    );
    const path = pathMatch?.[1]?.replace(/\\/g, "/");
    if (path && !seen.has(path)) {
      seen.add(path);
      refs.push(path);
    }
  }
  return refs.slice(0, 12);
}

export function buildImplementChatSummary(title: string): string {
  const label = (title || "Plan").trim().slice(0, 72);
  return `Implement plan: **${label}**`;
}

export function buildImplementPrompt(planMarkdown: string): string {
  const refs = extractPlanReferences(planMarkdown);
  const refsBlock =
    refs.length > 0
      ? `\n\nPre-read these plan reference files before editing:\n${refs.map((p) => `- ${p}`).join("\n")}`
      : "";
  return (
    "Implement the following approved plan. Follow steps in order.\n" +
    "Do not deviate without explaining.\n\n" +
    `${planMarkdown}\n\n` +
    "References from plan must be read before editing." +
    refsBlock
  );
}

subscribeChatSessions(() => {
  const session = getActiveSession();
  if (!session?.activePlanId) {
    if (activePlanId || activeDocument) {
      clearActivePlan();
    }
    return;
  }
  if (session.activePlanId !== activePlanId) {
    void bindPlanToSession(session.id);
  }
});
