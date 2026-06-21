import { EditorView } from "@codemirror/view";

import { getLastRunError, subscribeTaskTracker } from "../../agent/task-tracker";
import { getActiveRunId } from "../../agent/client";
import { setAgentMode } from "../../agent/mode";
import { launchAgentRun, type RunLauncherOptions } from "../../agent/run-launcher";
import { updateActiveSessionMode } from "../../chat/session-store";
import { createEditor } from "../../editor";
import {
  approveActivePlan,
  buildImplementChatSummary,
  buildImplementPrompt,
  ensurePlanReadyForImplement,
  getActivePlanDocument,
  getPlanSaveError,
  isPlanDirty,
  isPlanUnsavedDraft,
  markPlanImplementing,
  rejectActivePlan,
  saveActivePlan,
  setPlanEditorContent,
  subscribePlanStore,
} from "../../plan/store";

export type PlanEditorHost = {
  getRunLauncherOptions: () => RunLauncherOptions;
  onStatus: (message: string) => void;
  showAgentPanel?: () => void;
};

export function mountPlanEditor(
  parent: HTMLElement,
  host: PlanEditorHost,
): () => void {
  parent.className = "plan-editor-pane";
  parent.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "plan-editor-toolbar";

  const titleEl = document.createElement("span");
  titleEl.className = "plan-editor-title";
  titleEl.textContent = "Plan";

  const actions = document.createElement("div");
  actions.className = "plan-editor-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn btn-ghost btn-sm";
  saveBtn.textContent = "Save";

  const implementBtn = document.createElement("button");
  implementBtn.type = "button";
  implementBtn.className = "btn btn-primary btn-sm";
  implementBtn.textContent = "Implement";

  const overflowBtn = document.createElement("button");
  overflowBtn.type = "button";
  overflowBtn.className = "btn btn-ghost btn-sm plan-editor-overflow";
  overflowBtn.textContent = "⋯";
  overflowBtn.title = "More actions";

  const overflowMenu = document.createElement("div");
  overflowMenu.className = "plan-editor-overflow-menu";
  overflowMenu.hidden = true;

  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "btn btn-ghost btn-sm";
  approveBtn.textContent = "Approve";

  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.className = "plan-editor-overflow-item";
  rejectBtn.textContent = "Reject";

  overflowMenu.append(rejectBtn);
  actions.append(saveBtn, approveBtn, implementBtn, overflowBtn, overflowMenu);
  toolbar.append(titleEl, actions);

  const errorBanner = document.createElement("div");
  errorBanner.className = "plan-editor-error-banner";
  errorBanner.hidden = true;

  const empty = document.createElement("div");
  empty.className = "plan-editor-empty";
  empty.innerHTML =
    "<p>Run the Planning task — the plan is saved to <code>.idepus/plans/</code> and opened here.</p>" +
    "<p class=\"plan-editor-empty-hint\">Creating Workspace... Use <strong>Approve</strong> and <strong>Implement</strong> to finish.</p>";

  const editorHost = document.createElement("div");
  editorHost.className = "plan-editor-codemirror";
  editorHost.hidden = true;

  const draftBadge = document.createElement("div");
  draftBadge.className = "plan-editor-draft-badge";
  draftBadge.hidden = true;
  draftBadge.textContent = "Kaydedilmemiş taslak — Save ile diske yazın";

  parent.append(toolbar, errorBanner, draftBadge, empty, editorHost);

  let view: EditorView | null = null;
  let loadedPlanId: string | null = null;

  function destroyEditor(): void {
    if (view) {
      view.destroy();
      view = null;
    }
    loadedPlanId = null;
  }

  function mountEditor(content: string, planId: string): void {
    destroyEditor();
    editorHost.hidden = false;
    empty.hidden = true;
    loadedPlanId = planId;
    view = createEditor(editorHost, {
      doc: content,
      path: "plan.md",
      onChange: () => {
        if (view) {
          setPlanEditorContent(view.state.doc.toString());
        }
      },
    });
    view.dispatch({
      effects: EditorView.scrollIntoView(0, { y: "start" }),
    });
  }

  function render(): void {
    const doc = getActivePlanDocument();
    const runError = getLastRunError() ?? getPlanSaveError();

    if (!doc) {
      destroyEditor();
      editorHost.hidden = true;
      draftBadge.hidden = true;
      empty.hidden = false;
      titleEl.textContent = "Plan";
      saveBtn.disabled = true;
      implementBtn.disabled = true;
      overflowBtn.disabled = true;
      if (runError) {
        errorBanner.hidden = false;
        errorBanner.textContent = runError;
      } else {
        errorBanner.hidden = true;
        errorBanner.textContent = "";
      }
      return;
    }

    errorBanner.hidden = !runError;
    if (runError) {
      errorBanner.textContent = runError;
    }

    const draft = isPlanUnsavedDraft();
    draftBadge.hidden = !draft;
    titleEl.textContent =
      (doc.meta.title || "Plan") + (isPlanDirty() ? " *" : "");

    const status = doc.meta.status;
    approveBtn.disabled = status === "approved" || status === "implementing";
    implementBtn.disabled = status === "implementing" || status === "done";
    implementBtn.title =
      status === "draft"
        ? "Approve and run this plan in Agent mode"
        : "Run this plan in Agent mode";
    saveBtn.disabled = !isPlanDirty() && !draft;
    overflowBtn.disabled = false;

    if (loadedPlanId !== doc.meta.id) {
      mountEditor(doc.content, doc.meta.id);
    }
  }

  overflowBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    overflowMenu.hidden = !overflowMenu.hidden;
  });

  document.addEventListener("click", () => {
    overflowMenu.hidden = true;
  });

  saveBtn.addEventListener("click", () => {
    void saveActivePlan()
      .then((meta) => {
        if (meta) {
          host.onStatus("Plan saved");
        }
      })
      .catch((err) => host.onStatus(`Save failed: ${String(err)}`));
  });

  approveBtn.addEventListener("click", () => {
    overflowMenu.hidden = true;
    void approveActivePlan()
      .then((meta) => {
        if (meta) {
          host.onStatus("Plan approved");
        }
      })
      .catch((err) => host.onStatus(`Approve failed: ${String(err)}`));
  });

  rejectBtn.addEventListener("click", () => {
    overflowMenu.hidden = true;
    void rejectActivePlan()
      .then(() => host.onStatus("Plan rejected"))
      .catch((err) => host.onStatus(`Reject failed: ${String(err)}`));
  });

  implementBtn.addEventListener("click", () => {
    void implementActivePlan(host.getRunLauncherOptions(), host.onStatus, {
      showAgentPanel: host.showAgentPanel,
    }).catch((err) => host.onStatus(`Implement failed: ${String(err)}`));
  });

  const unsub = subscribePlanStore(render);
  const unsubTracker = subscribeTaskTracker(render);
  render();

  return () => {
    unsub();
    unsubTracker();
    destroyEditor();
    parent.innerHTML = "";
  };
}

export async function implementActivePlan(
  options: RunLauncherOptions,
  onStatus: (message: string) => void,
  hooks?: { showAgentPanel?: () => void },
): Promise<void> {
  const doc = getActivePlanDocument();
  if (!doc) {
    onStatus("No plan loaded");
    return;
  }
  if (!(await ensurePlanReadyForImplement())) {
    onStatus("Could not prepare plan — save or approve it first");
    return;
  }
  const saved = getActivePlanDocument();
  if (!saved) {
    onStatus("No plan loaded");
    return;
  }

  const prompt = buildImplementPrompt(saved.content);
  const chatSummary = buildImplementChatSummary(saved.meta.title);
  onStatus("Implementing plan in Agent mode…");

  setAgentMode("agent");
  updateActiveSessionMode("agent");

  const ok = await launchAgentRun(
    prompt,
    {
      ...options,
      agentId: "multi-file-editor",
    },
    {
      chatDisplay: chatSummary,
      launchMode: "agent",
    },
  );
  if (!ok) {
    setAgentMode("plan");
    updateActiveSessionMode("plan");
    onStatus("Could not start implement run — check status bar");
    return;
  }

  hooks?.showAgentPanel?.();

  if (!saved.meta.id.startsWith("draft-")) {
    await markPlanImplementing(saved.meta.id, getActiveRunId() ?? undefined);
  }
}
