import { applyDiffReview, cancelDiffReview } from "../cmdk";

export async function applyPatchFromUi(
  view: import("@codemirror/view").EditorView,
): Promise<void> {
  await applyDiffReview(view);
}

export async function rejectPatchFromUi(
  view: import("@codemirror/view").EditorView,
): Promise<void> {
  await cancelDiffReview(view);
}
