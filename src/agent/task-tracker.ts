import type { SseEvent } from "@aicery/sdk";

import { archiveCompletedRun } from "../chat/run-archive";
import { notifyPlanDraftFromText, notifyPlanWritten, clearActivePlan, syncPlanFromRun, applyPlanRunOutput } from "../plan/store";
import { getAgentMode, modeAllowsPatch } from "./mode";
import {
  addUserMessage,
  appendAssistantToken,
  appendAssistantTokenForRun,
  finalizeAssistantStream,
  finalizeAssistantStreamForRun,
  finalizePlanRunActivity,
  initPlanRunActivity,
  recordPlanActivityError,
  recordPlanStepActivity,
  recordPatchQueuedActivity,
  startAssistantStream,
  updateActiveSessionLastRunId,
} from "../chat/session-store";
import { detachStreamRun } from "./client";
import {
  getForegroundRunId,
  getRunEntry,
  unregisterRun,
  updateRunStatus,
} from "./run-registry";
import type { AgentRunRecord, AgentStep, ApprovalRequiredEvent } from "./types";

const MAX_HISTORY = 10;

let steps: AgentStep[] = [];
let history: AgentRunRecord[] = [];
let currentRun: AgentRunRecord | null = null;
let streamSummary = "";
let lastRunError: string | null = null;
let lastUserTaskInput = "";

export function setLastUserTaskInput(input: string): void {
  lastUserTaskInput = input.trim();
}

export function getLastUserTaskInput(): string {
  return lastUserTaskInput;
}

type Listener = () => void;
let listeners: Listener[] = [];

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function stepId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function subscribeTaskTracker(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getTaskSteps(): AgentStep[] {
  return [...steps];
}

export function getRunHistory(): AgentRunRecord[] {
  return [...history];
}

export function getCurrentRun(): AgentRunRecord | null {
  return currentRun;
}

export function getStreamSummary(): string {
  return streamSummary;
}

export function getLastRunError(): string | null {
  return lastRunError;
}

export function clearLastRunError(): void {
  lastRunError = null;
  notify();
}

export function setLastRunError(message: string): void {
  lastRunError = message.trim() || null;
  notify();
}

export function startRunTracking(
  runId: string,
  agentId: string,
  input: string,
  opts?: { chatDisplay?: string },
): void {
  steps = [];
  streamSummary = "";
  lastRunError = null;
  if (getAgentMode() === "plan") {
    clearActivePlan();
  }
  const chatText = opts?.chatDisplay ?? input;
  addUserMessage(chatText, runId);
  startAssistantStream(runId);
  if (getAgentMode() === "plan") {
    initPlanRunActivity(runId);
  }
  currentRun = {
    runId,
    agentId,
    input,
    status: "running",
    startedAt: Date.now(),
  };
  updateActiveSessionLastRunId(runId);
  addStep("run", `Run ${runId.slice(0, 8)}…`, "running");
  notify();
}

export function addStep(
  prefix: string,
  label: string,
  status: AgentStep["status"],
  detail?: string,
): string {
  const id = stepId(prefix);
  steps = [
    ...steps,
    {
      id,
      label,
      status,
      startedAt: Date.now(),
      detail,
    },
  ];
  notify();
  return id;
}

export function updateStep(
  id: string,
  status: AgentStep["status"],
  detail?: string,
): void {
  steps = steps.map((step) =>
    step.id === id
      ? {
          ...step,
          status,
          detail: detail ?? step.detail,
          endedAt: status === "done" || status === "error" ? Date.now() : step.endedAt,
        }
      : step,
  );
  notify();
}

export function finishRun(status: string, output?: string, runId?: string): void {
  const targetRunId = runId ?? currentRun?.runId;
  const isForeground = !targetRunId || currentRun?.runId === targetRunId;

  if (targetRunId) {
    const registryStatus =
      status === "completed"
        ? "completed"
        : status === "failed" || status === "error"
          ? "failed"
          : "running";
    updateRunStatus(targetRunId, registryStatus);
    if (registryStatus === "completed" || registryStatus === "failed") {
      unregisterRun(targetRunId);
      detachStreamRun(targetRunId);
    }
  }

  if (!isForeground && targetRunId) {
    if (output && !["failed", "error", status].includes(output)) {
      finalizeAssistantStreamForRun(targetRunId, output);
    } else if (output) {
      finalizeAssistantStreamForRun(
        targetRunId,
        `**Run failed**\n\n${output}`,
      );
    } else {
      finalizeAssistantStreamForRun(targetRunId);
    }
    notify();
    return;
  }

  if (!currentRun) {
    return;
  }
  const finished: AgentRunRecord = {
    ...currentRun,
    status,
    endedAt: Date.now(),
    output,
  };
  currentRun = finished;
  history = [finished, ...history].slice(0, MAX_HISTORY);
  void archiveCompletedRun(finished, [...steps]);
  const runStep = steps.find((s) => s.label.startsWith("Run "));
  if (runStep) {
    const ok = status === "completed";
    const generic = !output || output === status || output === "failed";
    const detail = ok ? output : generic ? undefined : output;
    updateStep(runStep.id, ok ? "done" : "error", detail);
  }
  if (output && !["failed", "error", status].includes(output)) {
    streamSummary = output;
    if (getAgentMode() === "plan" && targetRunId) {
      finalizePlanRunActivity(targetRunId);
    }
    finalizeStream(targetRunId, output);
  } else if (
    (status === "failed" || status === "error") &&
    output &&
    output !== status &&
    output !== "failed"
  ) {
    lastRunError = output;
    streamSummary = output;
    finalizeStream(targetRunId, `**Plan run failed**\n\n${output}`);
  } else {
    if (getAgentMode() === "plan" && targetRunId) {
      finalizePlanRunActivity(targetRunId);
    }
    finalizeStream(targetRunId);
  }
  currentRun = null;
  updateActiveSessionLastRunId(undefined);
  notify();
}

function appendToken(runId: string | undefined, text: string): void {
  if (runId) {
    appendAssistantTokenForRun(runId, text);
  } else {
    appendAssistantToken(text);
  }
}

function finalizeStream(runId: string | undefined, content?: string): void {
  if (runId) {
    finalizeAssistantStreamForRun(runId, content);
  } else {
    finalizeAssistantStream(content);
  }
}

export function resetTaskTracker(): void {
  steps = [];
  streamSummary = "";
  currentRun = null;
  notify();
}

let pendingApproval: ApprovalRequiredEvent | null = null;

export function getPendingApproval(): ApprovalRequiredEvent | null {
  return pendingApproval;
}

export function clearPendingApproval(): void {
  pendingApproval = null;
}

export function completePendingHitlStep(
  status: "done" | "error",
  detail?: string,
): void {
  const step = steps.find(
    (s) => s.label === "approval_required" && s.status === "running",
  );
  if (step) {
    updateStep(step.id, status, detail);
  }
  pendingApproval = null;
  notify();
}

export function failPendingHitlStep(detail: string): void {
  completePendingHitlStep("error", detail);
  streamSummary = `Shadow test failed: ${detail}`;
  notify();
}

export function pokeTaskTracker(): void {
  notify();
}

export function setStreamNote(message: string): void {
  streamSummary = message;
  notify();
}

export function hasPendingHitlStep(): boolean {
  return steps.some(
    (s) => s.label === "approval_required" && s.status === "running",
  );
}

const STREAM_SUMMARY_MAX = 8000;

function extractWritePlanId(data: Record<string, unknown>): string | undefined {
  const result = data.result as Record<string, unknown> | undefined;
  if (!result) {
    return undefined;
  }
  const meta = result.meta as { id?: string } | undefined;
  if (meta?.id) {
    return meta.id;
  }
  const nested = result.result as Record<string, unknown> | undefined;
  const nestedMeta = nested?.meta as { id?: string } | undefined;
  return nestedMeta?.id;
}

export function patchLastRunOutput(runId: string, output: string): void {
  const message = output.trim();
  if (!message) {
    return;
  }
  if (history[0]?.runId === runId) {
    history[0] = { ...history[0], output: message };
  }
  streamSummary = message.slice(-STREAM_SUMMARY_MAX);
  notify();
}
export function patchLastRunError(runId: string, errorMessage: string): void {
  const message = errorMessage.trim();
  if (!message) {
    return;
  }

  if (history[0]?.runId === runId) {
    history[0] = { ...history[0], output: message };
  }

  const runStep = steps.find((s) => s.label.startsWith("Run "));
  if (runStep && runStep.status === "error") {
    updateStep(runStep.id, "error", message);
  }

  lastRunError = message;
  streamSummary = message.slice(-STREAM_SUMMARY_MAX);
  finalizeAssistantStream(`**Plan run failed**\n\n${message}`);
  notify();
}

export function handleSseEvent(
  event: SseEvent,
  runId?: string,
): ApprovalRequiredEvent | null {
  const data = event.data ?? {};
  const isForeground =
    !runId || runId === getForegroundRunId() || currentRun?.runId === runId;

  if (event.event === "token") {
    const text = typeof data.text === "string" ? data.text : "";
    if (isForeground) {
      streamSummary = (streamSummary + text).slice(-STREAM_SUMMARY_MAX);
    }
    appendToken(runId, text);
    notify();
    return null;
  }

  if (event.event === "tool" || event.event === "step") {
    const label =
      typeof data.tool_name === "string"
        ? data.tool_name
        : typeof data.node === "string"
          ? data.node
          : "tool";
    if (event.event === "tool" && data.tool_name === "write_plan_file") {
      const planId = extractWritePlanId(data);
      if (planId) {
        void notifyPlanWritten(planId);
      }
    }
    if (
      event.event === "step" &&
      data.node === "write_plan" &&
      getAgentMode() === "plan"
    ) {
      const rid = runId ?? currentRun?.runId;
      if (rid) {
        void syncPlanFromRun(rid);
      }
    }
    if (getAgentMode() === "plan") {
      const rid = runId ?? currentRun?.runId;
      if (rid) {
        recordPlanStepActivity(rid, label);
      }
    }
    if (isForeground) {
      addStep("tool", label, "done");
    }
    return null;
  }

  if (event.event === "approval_required") {
    const toolName = String(data.tool_name ?? "apply_patch");
    const args = (data.arguments as Record<string, unknown>) ?? {};
    const patchPath = String(args.path ?? "");
    const batchDefer =
      toolName === "apply_patch" && modeAllowsPatch(getAgentMode());

    if (!isForeground) {
      if (runId) {
        updateRunStatus(runId, batchDefer ? "running" : "hitl");
      }
      notify();
      return {
        approval_id: String(data.approval_id ?? ""),
        tool_name: toolName,
        arguments: args,
        expires_at:
          typeof data.expires_at === "string" ? data.expires_at : undefined,
      };
    }

    if (batchDefer) {
      const fileName = patchPath.split(/[/\\]/).pop() ?? patchPath;
      streamSummary = patchPath
        ? `Applying changes… queued ${fileName}`
        : "Applying changes…";
      pendingApproval = null;
      const rid = runId ?? currentRun?.runId;
      if (rid && patchPath) {
        recordPatchQueuedActivity(rid, patchPath);
      }
      notify();
      return {
        approval_id: String(data.approval_id ?? ""),
        tool_name: toolName,
        arguments: args,
        expires_at:
          typeof data.expires_at === "string" ? data.expires_at : undefined,
      };
    }

    streamSummary = patchPath
      ? `Patch ready for ${patchPath} — review in the editor or use Apply / Reject below.`
      : "Patch approval required — review in the editor.";
    pendingApproval = {
      approval_id: String(data.approval_id ?? ""),
      tool_name: toolName,
      arguments: args,
      expires_at: typeof data.expires_at === "string" ? data.expires_at : undefined,
    };
    addStep(
      "hitl",
      "approval_required",
      "running",
      toolName,
    );
    notify();
    return pendingApproval;
  }

  if (event.event === "suspended") {
    notify();
    return null;
  }

  if (event.event === "done") {
    const status = String(data.status ?? "completed");
    const outputText =
      typeof data.output_text === "string"
        ? data.output_text
        : typeof data.message === "string"
          ? data.message
          : undefined;
    const errMsg =
      typeof data.error_message === "string" && data.error_message.trim()
        ? data.error_message.trim()
        : typeof data.message === "string" &&
            (status === "failed" || status === "error")
          ? data.message
          : typeof data.error_code === "string" &&
              data.error_code !== "RUN_FAILED" &&
              data.error_code !== status
            ? data.error_code
            : undefined;
    const failed = status === "failed" || status === "error";
    if (failed && errMsg) {
      lastRunError = errMsg;
    }
    const finalizeText =
      failed && errMsg
        ? outputText && outputText !== errMsg
          ? `${outputText}\n\n**Error:** ${errMsg}`
          : `**Plan run failed**\n\n${errMsg}`
        : outputText;
    finalizeStream(runId, finalizeText);
    const detail = failed ? errMsg : outputText;
    finishRun(status, detail ?? (status === "failed" ? undefined : status), runId);
    if (failed && finalizeText) {
      void notifyPlanDraftFromText(finalizeText, errMsg ?? undefined);
    } else if (!failed && getAgentMode() === "plan") {
      const rid = runId ?? currentRun?.runId ?? "";
      if (rid) {
        void applyPlanRunOutput(rid, finalizeText ?? "").then((ok) => {
          if (!ok) {
            recordPlanActivityError(
              rid,
              "No plan was saved — check workspace is open",
            );
          }
        });
      } else if (finalizeText?.includes("# Plan:")) {
        void notifyPlanDraftFromText(finalizeText);
      }
    } else if (!failed && finalizeText?.includes("# Plan:")) {
      void notifyPlanDraftFromText(finalizeText);
    }
    pendingApproval = null;
    return null;
  }

  if (event.event === "error") {
    const code =
      typeof data.error_code === "string" ? data.error_code : "";
    const msg = String(
      data.error_message ?? data.message ?? "Unknown agent error",
    );
    const detail = code ? `${code}: ${msg}` : msg;
    if (isForeground) {
      const runStep = steps.find((s) => s.label.startsWith("Run "));
      if (runStep) {
        updateStep(runStep.id, "error", detail);
      } else {
        addStep("run", "Agent error", "error", detail);
      }
    }
    finishRun("failed", detail, runId);
    return null;
  }

  return null;
}
