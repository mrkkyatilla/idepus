import type { DiffReviewSummary } from "../../cmdk/diff-review";
import { getDiffReviewSummary, isDiffReviewActive } from "../../cmdk/diff-review";
import { isPatchReviewOpening } from "../../agent/hitl-flow";
import { getAgentHitlSession, isAgentHitlActive } from "../../agent/hitl";
import type { HitlCardHost } from "./types";

function setPlainSummary(el: HTMLElement, text: string): void {
  el.replaceChildren();
  el.className = "agent-hitl-summary";
  el.textContent = text;
}

export function mountHitlCard(hostEl: HTMLElement, taskHost: HitlCardHost): {
  update: (summary: DiffReviewSummary | null) => void;
  scrollIntoView: () => void;
} {
  const card = document.createElement("div");
  card.className = "card agent-hitl-card";
  card.setAttribute("role", "alertdialog");
  card.setAttribute("aria-label", "Patch approval required");
  card.hidden = true;

  const title = document.createElement("p");
  title.className = "agent-hitl-title";
  title.textContent = "Review required";

  const pathEl = document.createElement("p");
  pathEl.className = "agent-hitl-path";

  const summaryEl = document.createElement("div");
  summaryEl.className = "agent-hitl-summary";

  const actions = document.createElement("div");
  actions.className = "agent-hitl-actions";

  const reviewBtn = document.createElement("button");
  reviewBtn.type = "button";
  reviewBtn.className = "btn btn-ghost btn-sm";
  reviewBtn.textContent = "Open in editor";

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "btn btn-primary btn-sm";
  applyBtn.textContent = "Apply";

  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.className = "btn btn-danger btn-sm";
  rejectBtn.textContent = "Reject";

  actions.append(reviewBtn, applyBtn, rejectBtn);
  card.append(title, pathEl, summaryEl, actions);
  hostEl.appendChild(card);

  reviewBtn.addEventListener("click", () => {
    taskHost.onReview();
    taskHost.getEditorView()?.focus();
  });

  applyBtn.addEventListener("click", () => {
    void taskHost.onApply();
  });

  rejectBtn.addEventListener("click", () => {
    void taskHost.onReject();
  });

  function update(summary: DiffReviewSummary | null): void {
    const session = getAgentHitlSession();
    const active = isAgentHitlActive() && session;

    if (!active) {
      card.hidden = true;
      return;
    }

    card.hidden = false;

    const fileName = session.path.split(/[/\\]/).pop() ?? session.path;
    pathEl.textContent = fileName;

    if (session.loadError) {
      setPlainSummary(summaryEl, session.loadError);
      applyBtn.disabled = true;
      rejectBtn.disabled = false;
      return;
    }

    rejectBtn.disabled = false;

    const opening = isPatchReviewOpening();
    const view = taskHost.getEditorView();
    const liveSummary = view ? getDiffReviewSummary(view) : null;
    const effectiveSummary = summary ?? liveSummary;

    if (effectiveSummary) {
      setPlainSummary(
        summaryEl,
        `${effectiveSummary.acceptedCount}/${effectiveSummary.totalHunks} hunks selected · Space to toggle · Alt+↑↓ navigate`,
      );
      applyBtn.disabled = effectiveSummary.acceptedCount === 0;
    } else if (opening) {
      setPlainSummary(summaryEl, "Loading diff in editor…");
      applyBtn.disabled = true;
    } else if (session) {
      const diffReady = Boolean(view && isDiffReviewActive(view));
      applyBtn.disabled = !diffReady;
      setPlainSummary(
        summaryEl,
        diffReady
          ? "All hunks selected — click Apply to confirm"
          : "Click Apply to load the diff in the editor",
      );
    } else {
      setPlainSummary(summaryEl, "Review patch in the editor");
      applyBtn.disabled = false;
    }
  }

  return {
    update,
    scrollIntoView: () => {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  };
}
