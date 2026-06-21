import { invoke } from "@tauri-apps/api/core";

import type { RunLauncherOptions } from "./run-launcher";
import { resumeRun } from "./client";
import { addStep, failPendingHitlStep, updateStep } from "./task-tracker";
import type { ApprovalRequiredEvent } from "./types";
import { loadShadowTestConfig } from "../shadow/config";
import type { CommandResult, ShadowPrepareResult } from "../shadow/types";

export type ShadowVerifyResult = {
  passed: boolean;
  summary: string;
  skipped: boolean;
};

function approvalPath(approval: ApprovalRequiredEvent): string {
  return String(approval.arguments.path ?? "");
}

function approvalRawPatch(approval: ApprovalRequiredEvent): string {
  return String(approval.arguments.raw_patch ?? "");
}

function approvalFileContent(approval: ApprovalRequiredEvent): string {
  return String(approval.arguments.file_content ?? "");
}

export async function verifyPatchInShadow(
  approval: ApprovalRequiredEvent,
  options: RunLauncherOptions,
): Promise<ShadowVerifyResult> {
  const workspaceRoot = options.workspaceRoot;
  const workspaceId = options.workspaceId ?? workspaceRoot ?? "default";
  if (!workspaceRoot) {
    return { passed: false, summary: "No workspace open", skipped: false };
  }

  const path = approvalPath(approval);
  const rawPatch = approvalRawPatch(approval);
  const fileContent = approvalFileContent(approval);
  if (!path || path === "." || !rawPatch) {
    return {
      passed: false,
      summary: path === "." ? "Cannot patch workspace root — no target file" : "Patch payload incomplete",
      skipped: false,
    };
  }

  const stepId = addStep("shadow", "shadow_verify", "running", path);
  let shadowId: string | null = null;

  try {
    const prepared = await invoke<ShadowPrepareResult>("shadow_prepare", {
      request: {
        workspace_id: workspaceId,
        workspace_root: workspaceRoot,
        files_to_modify: [path],
      },
    });
    shadowId = prepared.shadow_id;

    await invoke("shadow_apply_patch", {
      request: {
        shadow_id: shadowId,
        path,
        raw_patch: rawPatch,
        file_content: fileContent,
      },
    });

    const testConfig = loadShadowTestConfig();
    const result = await invoke<CommandResult>("shadow_run_command", {
      request: {
        shadow_id: shadowId,
        command: testConfig.command ?? null,
        args: testConfig.args ?? null,
        timeout_secs: testConfig.timeoutSecs ?? 120,
      },
    });

    if (result.skipped) {
      updateStep(stepId, "done", "skipped — no test command");
      return { passed: true, summary: "Shadow verify skipped (no test command)", skipped: true };
    }

    if (result.passed) {
      updateStep(stepId, "done", `exit ${result.exit_code}`);
      return { passed: true, summary: "Shadow test passed", skipped: false };
    }

    const summary = result.stderr_summary || `exit code ${result.exit_code}`;
    updateStep(stepId, "error", summary);
    return { passed: false, summary, skipped: false };
  } catch (err) {
    const message = String(err);
    updateStep(stepId, "error", message);
    return { passed: false, summary: message, skipped: false };
  } finally {
    if (shadowId) {
      await invoke("shadow_discard", { shadowId }).catch(() => {});
    }
  }
}

export async function rejectApprovalAfterShadowFail(
  runId: string,
  approval: ApprovalRequiredEvent,
  summary: string,
): Promise<void> {
  failPendingHitlStep(summary);
  await resumeRun(runId, {
    decision: "reject",
    approvalId: approval.approval_id,
  });
}
