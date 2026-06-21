import { invoke } from "@tauri-apps/api/core";
import { RangeSetBuilder, StateEffect, StateField, Prec } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  KeyBinding,
  WidgetType,
  keymap,
} from "@codemirror/view";

import { setEditorReadOnly } from "../editor-editable";
import type { Patch, PatchHunk } from "../diff/types";

export type DiffReviewSummary = {
  patch: Patch;
  acceptedCount: number;
  totalHunks: number;
  activeIndex: number;
};

export function formatDiffReviewLabel(summary: DiffReviewSummary): string {
  const hunkNum = summary.activeIndex + 1;
  return `${hunkNum}/${summary.totalHunks} hunks · ${summary.acceptedCount} selected`;
}

type DiffReviewState = {
  patch: Patch;
  acceptedIds: Set<string>;
  activeIndex: number;
};

const setDiffReviewEffect = StateEffect.define<DiffReviewState | null>();

let onSummaryChange: ((summary: DiffReviewSummary | null) => void) | null = null;

class InsertPreviewWidget extends WidgetType {
  constructor(private text: string) {
    super();
  }

  eq(other: InsertPreviewWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "diff-line-insert";
    el.textContent = this.text;
    return el;
  }
}

function emitSummary(review: DiffReviewState | null): void {
  const summary = review
    ? {
        patch: review.patch,
        acceptedCount: review.acceptedIds.size,
        totalHunks: review.patch.hunks.length,
        activeIndex: review.activeIndex,
      }
    : null;

  onSummaryChange?.(summary);
  for (const listener of diffReviewSubscribers) {
    listener(summary);
  }
}

const diffReviewSubscribers: ((summary: DiffReviewSummary | null) => void)[] = [];

export function subscribeDiffReview(
  listener: (summary: DiffReviewSummary | null) => void,
): () => void {
  diffReviewSubscribers.push(listener);
  return () => {
    const idx = diffReviewSubscribers.indexOf(listener);
    if (idx >= 0) {
      diffReviewSubscribers.splice(idx, 1);
    }
  };
}

function buildDecorations(
  state: EditorState,
  review: DiffReviewState | null,
): DecorationSet {
  if (!review) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;

  review.patch.hunks.forEach((hunk, index) => {
    const isActive = index === review.activeIndex;
    const isAccepted = review.acceptedIds.has(hunk.id);

    try {
      const endLine = doc.line(hunk.end_line);
      for (let ln = hunk.start_line; ln <= hunk.end_line; ln++) {
        const line = doc.line(ln);
        const classes = [
          "diff-line-delete",
          isActive ? "diff-hunk-active" : "",
          isAccepted ? "diff-hunk-accepted" : "",
        ]
          .filter(Boolean)
          .join(" ");
        builder.add(line.from, line.from, Decoration.line({ class: classes }));
      }

      builder.add(
        endLine.to,
        endLine.to,
        Decoration.widget({
          widget: new InsertPreviewWidget(hunk.replace_text),
          side: 1,
          block: true,
        }),
      );
    } catch {
      // line out of range
    }
  });

  return builder.finish();
}

const diffReviewField = StateField.define<DiffReviewState | null>({
  create() {
    return null;
  },

  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiffReviewEffect)) {
        return effect.value;
      }
    }
    return value;
  },

  provide: (field) =>
    EditorView.decorations.compute([field], (state) =>
      buildDecorations(state, state.field(field)),
    ),
});

function getReview(view: EditorView): DiffReviewState | null {
  return view.state.field(diffReviewField);
}

function setReview(view: EditorView, review: DiffReviewState | null): void {
  view.dispatch({ effects: setDiffReviewEffect.of(review) });
  emitSummary(review);
}

function clampIndex(hunks: PatchHunk[], index: number): number {
  if (hunks.length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(index, hunks.length - 1));
}

export function setDiffReviewSummaryListener(
  listener: ((summary: DiffReviewSummary | null) => void) | null,
): void {
  onSummaryChange = listener;
}

export function isDiffReviewActive(view: EditorView): boolean {
  return getReview(view) !== null;
}

export function enterDiffReview(view: EditorView, patch: Patch): void {
  const review: DiffReviewState = {
    patch,
    acceptedIds: new Set(patch.hunks.map((h) => h.id)),
    activeIndex: 0,
  };
  setEditorReadOnly(view, true);
  setReview(view, review);
  scrollToActiveHunk(view, review);
}

export function exitDiffReview(view: EditorView): void {
  setEditorReadOnly(view, false);
  setReview(view, null);
}

export async function enterDiffReviewFromRaw(
  view: EditorView,
  filePath: string,
  rawPatch: string,
): Promise<Patch> {
  const patch = await invoke<Patch>("parse_patch", {
    request: {
      raw_llm_output: rawPatch,
      file_path: filePath,
      file_content: view.state.doc.toString(),
    },
  });
  enterDiffReview(view, patch);
  return patch;
}

function scrollToActiveHunk(view: EditorView, review: DiffReviewState): void {
  const hunk = review.patch.hunks[review.activeIndex];
  if (!hunk) {
    return;
  }
  try {
    const line = view.state.doc.line(hunk.start_line);
    view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
  } catch {
    // ignore
  }
}

function toggleActiveHunk(view: EditorView): boolean {
  const review = getReview(view);
  if (!review) {
    return false;
  }
  const hunk = review.patch.hunks[review.activeIndex];
  if (!hunk) {
    return false;
  }
  const acceptedIds = new Set(review.acceptedIds);
  if (acceptedIds.has(hunk.id)) {
    acceptedIds.delete(hunk.id);
  } else {
    acceptedIds.add(hunk.id);
  }
  const next: DiffReviewState = { ...review, acceptedIds };
  setReview(view, next);
  return true;
}

export function toggleCurrentHunk(view: EditorView): boolean {
  return toggleActiveHunk(view);
}

export function acceptAllHunks(view: EditorView): boolean {
  const review = getReview(view);
  if (!review) {
    return false;
  }
  setReview(view, {
    ...review,
    acceptedIds: new Set(review.patch.hunks.map((h) => h.id)),
  });
  return true;
}

export function clearAcceptedHunks(view: EditorView): boolean {
  const review = getReview(view);
  if (!review) {
    return false;
  }
  setReview(view, { ...review, acceptedIds: new Set() });
  return true;
}

export function goToNextHunk(view: EditorView): boolean {
  return moveActiveHunk(view, 1);
}

export function goToPrevHunk(view: EditorView): boolean {
  return moveActiveHunk(view, -1);
}

function moveActiveHunk(view: EditorView, delta: number): boolean {
  const review = getReview(view);
  if (!review) {
    return false;
  }
  const next: DiffReviewState = {
    ...review,
    activeIndex: clampIndex(
      review.patch.hunks,
      review.activeIndex + delta,
    ),
  };
  setReview(view, next);
  scrollToActiveHunk(view, next);
  return true;
}

export function getAcceptedHunkIds(view: EditorView): string[] {
  const review = getReview(view);
  if (!review) {
    return [];
  }
  return Array.from(review.acceptedIds);
}

export async function applyAcceptedHunks(view: EditorView): Promise<string | null> {
  const review = getReview(view);
  if (!review || review.acceptedIds.size === 0) {
    return null;
  }

  const newContent = await invoke<string>("apply_patch_hunks", {
    request: {
      path: review.patch.path,
      file_content: view.state.doc.toString(),
      hunks: review.patch.hunks,
      accepted_ids: Array.from(review.acceptedIds),
    },
  });

  exitDiffReview(view);
  return newContent;
}

export async function rejectCurrentPatch(view: EditorView): Promise<void> {
  const review = getReview(view);
  if (review) {
    await invoke("reject_patch", { patchId: review.patch.patch_id });
  }
  exitDiffReview(view);
}

let onApplyRequest: ((view: EditorView) => void) | null = null;

export function setDiffReviewApplyListener(
  listener: ((view: EditorView) => void) | null,
): void {
  onApplyRequest = listener;
}

export function diffReviewKeymap(): KeyBinding[] {
  return [
    {
      key: "Tab",
      run: (view) => {
        if (!getReview(view)) {
          return false;
        }
        return toggleActiveHunk(view);
      },
    },
    {
      key: "Space",
      run: (view) => {
        if (!getReview(view)) {
          return false;
        }
        return toggleActiveHunk(view);
      },
    },
    {
      key: "Alt-ArrowDown",
      run: (view) => {
        if (!getReview(view)) {
          return false;
        }
        return moveActiveHunk(view, 1);
      },
    },
    {
      key: "Alt-ArrowUp",
      run: (view) => {
        if (!getReview(view)) {
          return false;
        }
        return moveActiveHunk(view, -1);
      },
    },
    {
      key: "Mod-]",
      run: (view) => {
        if (!getReview(view)) {
          return false;
        }
        return moveActiveHunk(view, 1);
      },
    },
    {
      key: "Mod-[",
      run: (view) => {
        if (!getReview(view)) {
          return false;
        }
        return moveActiveHunk(view, -1);
      },
    },
    {
      key: "Enter",
      run: (view) => {
        if (!getReview(view)) {
          return false;
        }
        onApplyRequest?.(view);
        return true;
      },
    },
  ];
}

/** Highest precedence so Tab/Space win over indentWithTab during review. */
export function diffReviewKeymapExtension() {
  return Prec.highest(keymap.of(diffReviewKeymap()));
}

export function diffReviewExtension() {
  return diffReviewField;
}

export function getDiffReviewSummary(view: EditorView): DiffReviewSummary | null {
  const review = getReview(view);
  if (!review) {
    return null;
  }
  return {
    patch: review.patch,
    acceptedCount: review.acceptedIds.size,
    totalHunks: review.patch.hunks.length,
    activeIndex: review.activeIndex,
  };
}
