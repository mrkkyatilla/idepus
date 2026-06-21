import {
  cancelActiveRun,
  createRun,
  getActiveRunId,
  getRun,
  resumeRun,
  startStreamRun,
} from "./client";
import {
  clearPatchQueue,
  enqueuePatch,
  getNextPending,
  getPatchByApprovalId,
  getReviewingItem,
  getStagedPatches,
  hasPendingPatches,
  hasStagedPatches,
  isQueueProcessing,
  markReviewing,
  resetStuckReviewing,
  clearReviewingClock,
  setQueueProcessing,
  setQueueResumeHandler,
  subscribePatchQueue,
  updatePatchByApprovalId,
} from "./patch-queue";
import { findProtectedViolations } from "./protected-check";
import {
  defaultAgentForMode,
  getAgentMode,
  modeAllowsPatch,
  type AgentMode,
} from "./mode";
import { resolveAgentForTask } from "./routing";
import { isAnalysisTask } from "./intent";
import { rejectApprovalAfterShadowFail } from "./shadow-verify";
import { snapshotFile } from "./snapshot";
import {
  finishRun,
  handleSseEvent,
  hasPendingHitlStep,
  patchLastRunError,
  patchLastRunOutput,
  startRunTracking,
  setLastUserTaskInput,
  pokeTaskTracker,
  setStreamNote,
} from "./task-tracker";
import { fetchSidecarStatus } from "./config";
import { pingBridge } from "./bridge-preflight";
import { getActiveProvider, syncAiceryProviderEnv } from "../llm/config";
import { refreshProviderBanners } from "../ui/task-tracker";
import { loadTeamContext, teamContextPromptBlock } from "../config/workspace-config";
import {
  formatChangesMentionBlock,
  formatTargetFilesBlock,
  getMentions,
  resetMentionsForPrompt,
} from "../context/mention-autocomplete";
import { buildMemoryContext, formatWorkingMessages } from "../memory/compose";
import { listRecentChanges } from "../memory/persist";
import { recordAcceptedChange } from "../memory/index-change";
import { setPendingContextHits } from "../memory/store";
import { getActiveSession, getActiveSessionId, updateActiveSessionSummary } from "../chat/session-store";
import { canStartRun, registerRunForLaunch } from "./run-registry";
import type { ApprovalRequiredEvent } from "./types";
import type { EditorView } from "@codemirror/view";

export type RunLauncherOptions = {
  agentId?: string;
  workspaceRoot?: string;
  workspaceId?: string;
  getEditorView: () => EditorView | null;
  getActiveFilePath?: () => string | undefined;
  openFile: (path: string, fallbackContent?: string) => Promise<void>;
  onStatus: (message: string) => void;
};

function formatAgentError(err: unknown): string {
  const message = String(err);
  if (message.includes("Connection refused") || message.includes("Errno 111")) {
    return "Tool bridge unreachable — restart idepus (npm run tauri dev) then ./scripts/aicery-up.sh";
  }
  if (message.includes("sidecar unreachable") || message.includes("Load failed")) {
    return "Aicery sidecar unreachable — run: ./scripts/aicery-up.sh";
  }
  if (message.includes("UNKNOWN_AGENT") || message.includes("Unknown agent")) {
    return "Agent graph not loaded — restart Aicery: ./scripts/aicery-up.sh";
  }
  if (message.includes("workspace_root is not a directory")) {
    return "Workspace path not sent to agent — restart idepus and try again";
  }
  if (message.includes("createRun HTTP error")) {
    return message.replace("createRun HTTP error:", "Aicery error:");
  }
  return message;
}

let activeLauncherOptions: RunLauncherOptions | null = null;
let activeRunIdForQueue: string | null = null;
let batchSettleListenerReady = false;

function ensureBatchSettleListener(): void {
  if (batchSettleListenerReady) {
    return;
  }
  batchSettleListenerReady = true;
  subscribePatchQueue(() => {
    if (
      !hasStagedPatches() &&
      !hasPendingPatches() &&
      !hasPendingHitlStep() &&
      getReviewingItem() === null
    ) {
      activeLauncherOptions = null;
      activeRunIdForQueue = null;
    }
  });
}

export type LaunchRunMeta = {
  /** Shorter text shown in chat user bubble (agent still receives full `input`). */
  chatDisplay?: string;
  /** Override mode for routing/enrichment (e.g. implement while UI still in plan). */
  launchMode?: AgentMode;
};

async function resolveForLaunch(
  input: string,
  options: RunLauncherOptions,
  meta?: LaunchRunMeta,
): Promise<{ agentId: string; enrichedInput: string; provider?: string }> {
  const mode = meta?.launchMode ?? getAgentMode();
  const team = await loadTeamContext(options.workspaceRoot ?? "");
  const teamBlock = teamContextPromptBlock(team);
  let enrichedInput = teamBlock
    ? `${teamBlock}\n\n[Task]\n${input.trim()}`
    : input.trim();

  const session = getActiveSession();
  const conversationBlock = session
    ? formatWorkingMessages(session.messages)
    : "";
  if (conversationBlock) {
    enrichedInput = `${conversationBlock}\n\n${enrichedInput}`;
  }
  const memoryResult = await buildMemoryContext(input.trim(), options.workspaceId, {
    sessionSummary: session?.sessionSummary,
  });
  if (memoryResult.block) {
    enrichedInput = `${memoryResult.block}${enrichedInput}`;
  }
  setPendingContextHits(memoryResult.hits);

  if (getMentions().some((m) => m.kind === "changes") && options.workspaceId) {
    const recent = await listRecentChanges(options.workspaceId, 10);
    const block = formatChangesMentionBlock(recent);
    enrichedInput = `${block}\n\n${enrichedInput}`;
  }

  const targetFiles = formatTargetFilesBlock(input.trim(), getMentions(), {
    activeFilePath: options.getActiveFilePath?.(),
    workspaceRoot: options.workspaceRoot,
  });
  if (targetFiles) {
    enrichedInput = `${targetFiles}${enrichedInput}`;
  }

  if (mode === "plan") {
    enrichedInput =
      "[Plan mode — explore with grep and read_file, then write a markdown plan via write_plan_file. No patches or file edits.]\n\n" +
      enrichedInput;
  }

  if (mode === "ask" || mode === "plan") {
    return {
      agentId: options.agentId ?? defaultAgentForMode(mode),
      enrichedInput,
    };
  }

  const resolved = await resolveAgentForTask(
    input.trim(),
    options.workspaceRoot!,
    options.workspaceId,
  );
  return {
    agentId: options.agentId ?? resolved.agentId,
    provider: resolved.provider,
    enrichedInput,
  };
}

export async function launchAgentRun(
  input: string,
  options: RunLauncherOptions,
  meta?: LaunchRunMeta,
): Promise<boolean> {
  if (!input.trim()) {
    options.onStatus("Enter a task description");
    return false;
  }
  if (getAgentMode() !== "multitask" && getActiveRunId()) {
    options.onStatus("Another agent run is active");
    return false;
  }
  const capacity = canStartRun();
  if (!capacity.ok) {
    options.onStatus(capacity.message ?? "Run limit reached");
    return false;
  }

  if (!options.workspaceRoot) {
    options.onStatus("Open a workspace folder first");
    return false;
  }

  if (!getActiveSession()) {
    options.onStatus("No active chat session — open a workspace or start a new chat");
    return false;
  }

  const sidecar = await fetchSidecarStatus();
  if (!sidecar.ok) {
    options.onStatus(
      `Aicery offline: ${sidecar.message} — run ./scripts/aicery-up.sh`,
    );
    return false;
  }

  const resolved = await resolveForLaunch(input.trim(), options, meta);
  const agentId = resolved.agentId;
  setLastUserTaskInput(input.trim());

  if (!sidecar.agents.includes(agentId)) {
    options.onStatus(
      `Agent "${agentId}" not found. Available: ${sidecar.agents.join(", ") || "none"} — set PLUGIN_PATHS=idepus-plugin`,
    );
    return false;
  }

  try {
    const activeProvider = await getActiveProvider();
    refreshProviderBanners();
    if (!activeProvider.has_api_key) {
      options.onStatus(
        "Mock LLM — add API key in Settings → LLM, then run ./scripts/aicery-reload-provider.sh",
      );
    } else {
      const sync = await syncAiceryProviderEnv();
      if (sync.needs_aicery_reload) {
        options.onStatus(
          "LLM key saved — run ./scripts/aicery-reload-provider.sh so agent uses your model",
        );
      }
    }
  } catch {
    // provider settings optional
  }

  if (getAgentMode() === "plan") {
    const bridge = await pingBridge(options.workspaceRoot);
    if (!bridge.ok) {
      options.onStatus(
        `Warning: ${bridge.message} — plan tools may fail until the bridge is reachable`,
      );
    }
  }

  if (modeAllowsPatch(meta?.launchMode ?? getAgentMode())) {
    clearPatchQueue();
  }
  ensureBatchSettleListener();
  activeLauncherOptions = options;
  setQueueResumeHandler((runId, approvalId, accepted) => {
    void onPatchReviewComplete(runId, approvalId, accepted);
  });

  options.onStatus(`Starting ${agentId}…`);
  resetMentionsForPrompt();

  try {
    const run = await createRun(agentId, resolved.enrichedInput, {
      workspaceId: options.workspaceId,
      hostWorkspaceRoot: options.workspaceRoot,
    });
    activeRunIdForQueue = run.id;
    registerRunForLaunch(run.id, agentId, input.trim(), getActiveSessionId());
    startRunTracking(run.id, agentId, input.trim(), {
      chatDisplay: meta?.chatDisplay,
    });
    options.onStatus(`Agent run ${run.id.slice(0, 8)}…`);

    void consumeStream(run.id, input.trim(), options);
    return true;
  } catch (err) {
    options.onStatus(`Agent start failed: ${formatAgentError(err)}`);
    finishRun("error", String(err));
    activeLauncherOptions = null;
    activeRunIdForQueue = null;
    return false;
  }
}

async function waitForPatchQueueIdle(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (
    hasPendingPatches() ||
    getReviewingItem() !== null ||
    isQueueProcessing()
  ) {
    if (resetStuckReviewing()) {
      continue;
    }
    if (Date.now() >= deadline) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function resumeRunWithRetry(
  runId: string,
  options: Parameters<typeof resumeRun>[1],
): Promise<void> {
  try {
    await resumeRun(runId, options);
  } catch (firstErr) {
    await resumeRun(runId, options).catch(() => {
      throw firstErr;
    });
  }
}

async function consumeStream(
  runId: string,
  runInput: string,
  options: RunLauncherOptions,
): Promise<void> {
  try {
    await startStreamRun(runId, (event) => {
      const approval = handleSseEvent(event, runId);
      const mode = getAgentMode();
      if (approval?.tool_name === "apply_patch" && !modeAllowsPatch(mode)) {
        options.onStatus("Read-only mode — rejecting patch");
        void resumeRun(runId, {
          decision: "reject",
          approvalId: approval.approval_id,
        }).catch(() => {});
        return;
      }
      if (approval?.tool_name === "apply_patch" && isAnalysisTask(runInput)) {
        options.onStatus("Explain request — skipping patch review");
        void resumeRun(runId, {
          decision: "reject",
          approvalId: approval.approval_id,
        }).catch(() => {});
        return;
      }
      if (approval?.tool_name === "apply_patch") {
        enqueuePatch(approval, runId);
        void processNextInQueue(runId, options);
      }
    });
    await waitForPatchQueueIdle();
    await enrichRunResult(runId, options);
  } catch (err) {
    if (getActiveRunId()) {
      finishRun("error", String(err));
      options.onStatus(`Agent stream error: ${formatAgentError(err)}`);
    } else {
      await enrichRunResult(runId, options);
    }
  } finally {
    const keepForHitl =
      hasPendingHitlStep() ||
      hasPendingPatches() ||
      getReviewingItem() !== null ||
      hasStagedPatches();
    if (!keepForHitl) {
      activeLauncherOptions = null;
      activeRunIdForQueue = null;
    }
    setQueueProcessing(false);
    notifyBatchReviewReady(runId, options);
  }
}

function notifyBatchReviewReady(
  runId: string,
  options: RunLauncherOptions,
): void {
  const staged = getStagedPatches();
  if (staged.length === 0) {
    return;
  }
  const count = staged.length;
  const label = count === 1 ? "1 file change" : `${count} file changes`;
  setStreamNote(
    `Review ${label} below — ✓ keep or ✗ discard each file when ready.`,
  );
  pokeTaskTracker();
  options.onStatus(`Run finished — review ${label}`);
}

async function processNextInQueue(
  runId: string,
  options: RunLauncherOptions,
): Promise<void> {
  resetStuckReviewing();
  if (isQueueProcessing() || getReviewingItem()) {
    return;
  }
  const next = getNextPending();
  if (!next) {
    return;
  }

  setQueueProcessing(true);
  markReviewing(next.id);

  try {
    await handlePatchApproval(runId, next.approval, options);
  } finally {
    clearReviewingClock();
    setQueueProcessing(false);
    if (hasPendingPatches()) {
      void processNextInQueue(runId, options);
    }
  }
}

async function handlePatchApproval(
  runId: string,
  approval: ApprovalRequiredEvent,
  options: RunLauncherOptions,
): Promise<void> {
  const path = String(approval.arguments.path ?? "");
  const workspaceRoot = options.workspaceRoot;
  let snapshot: string | undefined;

  if (workspaceRoot) {
    const team = await loadTeamContext(workspaceRoot);
    const violations = findProtectedViolations(path, team);
    if (violations.length > 0) {
      options.onStatus(
        `Warning: patch touches protected path (${violations[0]})`,
      );
    }
    snapshot = (await snapshotFile(workspaceRoot, path)) ?? undefined;
    if (snapshot) {
      updatePatchByApprovalId(approval.approval_id, "reviewing", snapshot);
    }
  }

  const fileName = path.split(/[/\\]/).pop() ?? path;
  options.onStatus(`Queuing ${fileName}…`);

  try {
    await resumeRunWithRetry(runId, {
      decision: "approve",
      approvalId: approval.approval_id,
      arguments: {
        ...approval.arguments,
        already_applied: true,
      },
    });
    updatePatchByApprovalId(approval.approval_id, "staged", snapshot);
    options.onStatus(`Queued ${fileName} for batch review`);
  } catch (err) {
    updatePatchByApprovalId(approval.approval_id, "shadow_failed");
    await rejectApprovalAfterShadowFail(
      runId,
      approval,
      `Could not continue agent run: ${String(err)}`,
    );
  }
}

export async function onPatchReviewComplete(
  runId: string,
  approvalId: string,
  accepted: boolean,
): Promise<void> {
  updatePatchByApprovalId(approvalId, accepted ? "accepted" : "rejected");
  if (accepted) {
    const item = getPatchByApprovalId(approvalId);
    if (item) {
      void recordAcceptedChange(runId, item.approval);
    }
  }
  const options = activeLauncherOptions;
  if (!options || activeRunIdForQueue !== runId) {
    return;
  }
  if (!hasPendingHitlStep() && !hasPendingPatches() && !hasStagedPatches()) {
    activeLauncherOptions = null;
    activeRunIdForQueue = null;
  }
  void processNextInQueue(runId, options);
}

async function enrichRunResult(
  runId: string,
  options: RunLauncherOptions,
): Promise<void> {
  try {
    const run = await getRun(runId);
    const output = run.output_text?.trim();
    const failed = run.status === "failed" || run.status === "error";
    const message = run.error_message?.trim() || output;

    if (failed && message) {
      patchLastRunError(runId, message);
      options.onStatus(`Agent failed: ${message.slice(0, 160)}`);
      const { notifyPlanDraftFromText } = await import("../plan/store");
      void notifyPlanDraftFromText(message, message);
    } else if (failed && output) {
      patchLastRunOutput(runId, output);
      const { notifyPlanDraftFromText } = await import("../plan/store");
      void notifyPlanDraftFromText(output);
    } else if (failed) {
      options.onStatus("Agent run failed — check Aicery logs");
    } else if (run.status === "completed" && output) {
      patchLastRunOutput(runId, output);
      updateActiveSessionSummary(output.slice(0, 500));
      options.onStatus("Agent completed");
      if (getAgentMode() === "plan") {
        const { applyPlanRunOutput } = await import("../plan/store");
        const { recordPlanActivityError } = await import("../chat/session-store");
        const ok = await applyPlanRunOutput(runId, output);
        if (!ok) {
          recordPlanActivityError(
            runId,
            "No plan was saved — check workspace is open",
          );
        }
      }
    }
  } catch {
    // ignore lookup errors
  }
}

export async function cancelLauncherRun(
  onStatus: (message: string) => void,
): Promise<void> {
  await cancelActiveRun();
  clearPatchQueue();
  finishRun("cancelled");
  activeLauncherOptions = null;
  activeRunIdForQueue = null;
  onStatus("Agent run cancelled");
}
