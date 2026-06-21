import type { EditorView } from "@codemirror/view";

import {
  applyDiffReview,
  cancelDiffReview,
  formatDiffReviewLabel,
  goToNextHunk,
  goToPrevHunk,
} from "../cmdk";
import type { DiffReviewSummary } from "../cmdk/diff-review";

export type DiffToolbarHost = {
  getEditorView: () => EditorView | null;
};

const bar = () => document.querySelector<HTMLElement>("#diff-review-bar")!;
const label = () => document.querySelector<HTMLElement>("#diff-review-label")!;
const applyBtn = () => document.querySelector<HTMLButtonElement>("#diff-apply")!;

export function updateDiffToolbar(
  active: boolean,
  summary: DiffReviewSummary | null,
): void {
  const statusbar = document.querySelector(".statusbar");

  if (active && summary) {
    bar().hidden = false;
    applyBtn().disabled = summary.acceptedCount === 0;
    label().textContent = `${formatDiffReviewLabel(summary)} · Space toggle`;
    statusbar?.classList.add("diff-review");
  } else {
    bar().hidden = true;
    applyBtn().disabled = true;
    statusbar?.classList.remove("diff-review");
  }
}

export function bindDiffToolbar(host: DiffToolbarHost): void {
  document.querySelector("#diff-apply")?.addEventListener("click", () => {
    const view = host.getEditorView();
    if (view) {
      void applyDiffReview(view);
    }
  });

  document.querySelector("#diff-cancel")?.addEventListener("click", () => {
    const view = host.getEditorView();
    if (view) {
      void cancelDiffReview(view);
    }
  });

  document.querySelector("#diff-prev")?.addEventListener("click", () => {
    const view = host.getEditorView();
    if (view) {
      goToPrevHunk(view);
    }
  });

  document.querySelector("#diff-next")?.addEventListener("click", () => {
    const view = host.getEditorView();
    if (view) {
      goToNextHunk(view);
    }
  });
}
