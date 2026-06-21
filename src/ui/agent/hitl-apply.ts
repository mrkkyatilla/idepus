import type { EditorView } from "@codemirror/view";

import { getActiveRunId } from "../../agent/client";
import { isAgentHitlActive } from "../../agent/hitl";
import { openPatchReview, type HitlFlowOptions } from "../../agent/hitl-flow";
import { getPendingApproval, hasPendingHitlStep } from "../../agent/task-tracker";
import { applyPatchFromUi } from "../diff-actions";

export type HitlApplyHost = HitlFlowOptions;

export async function applyAgentPatchFromCard(host: HitlApplyHost): Promise<void> {
  let view: EditorView | null = host.getEditorView();

  if (!isAgentHitlActive() && hasPendingHitlStep()) {
    const runId = getActiveRunId();
    const approval = getPendingApproval();
    if (!runId || !approval) {
      host.onStatus("No patch waiting for review");
      return;
    }
    const opened = await openPatchReview(runId, approval, host);
    if (!opened) {
      return;
    }
    view = host.getEditorView();
  }

  if (!view) {
    host.onStatus("Open a file in the editor to apply the patch");
    return;
  }

  await applyPatchFromUi(view);
}
