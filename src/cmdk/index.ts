import { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";

import {
  attachMentionAutocomplete,
  getMentions,
  resetMentionsForPrompt,
} from "../context/mention-autocomplete";
import type { Patch } from "../diff/types";
import {
  applyAcceptedHunks,
  diffReviewExtension,
  enterDiffReview,
  isDiffReviewActive,
  rejectCurrentPatch,
  setDiffReviewApplyListener,
  setDiffReviewSummaryListener,
} from "./diff-review";
import { isAgentHitlActive, applyAgentHitl, rejectAgentHitl, rejectPendingHitlFromUi } from "../agent/hitl";
import {
  clearGhostPreview,
  ghostPreviewExtension,
  setGhostPreview,
} from "./ghost-preview";
import { buildCmdkMessages } from "../llm/config";
import {
  cancelStream,
  currentRequestId,
  isStreaming,
  newRequestId,
  startStream,
} from "../llm/stream-client";
import type { DiffReviewSummary } from "./diff-review";

export type CmdKContext = {
  filePath: string;
  workspaceRoot?: string;
  onStatus: (message: string) => void;
  onStreamingChange: (streaming: boolean) => void;
  onDiffReviewChange?: (summary: DiffReviewSummary | null) => void;
  onApplyPatch?: (newContent: string, filePath: string) => void;
};

type PromptState = {
  from: number;
  to: number;
  selection: string;
};

let cmdkContext: CmdKContext | null = null;
let detachMention: (() => void) | null = null;
let lastPromptState: PromptState | null = null;
let lastInstruction: string | null = null;

export function initCmdKContext(ctx: CmdKContext): void {
  cmdkContext = ctx;
  setDiffReviewSummaryListener((summary) => {
    ctx.onDiffReviewChange?.(summary);
  });
  setDiffReviewApplyListener((view) => {
    void applyDiffReview(view);
  });
}

export function cmdkExtensions() {
  return [ghostPreviewExtension(), diffReviewExtension()];
}

export {
  acceptAllHunks,
  clearAcceptedHunks,
  enterDiffReviewFromRaw,
  formatDiffReviewLabel,
  goToNextHunk,
  goToPrevHunk,
  toggleCurrentHunk,
} from "./diff-review";

function showPromptOverlay(
  view: EditorView,
  pos: number,
  promptState: PromptState,
) {
  const ctx = cmdkContext!;
  removePromptOverlay();
  resetMentionsForPrompt();

  const coords = view.coordsAtPos(pos);
  const editorRect = view.dom.getBoundingClientRect();
  if (!coords) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "cmdk-prompt-overlay";
  overlay.className = "cmdk-prompt-overlay";
  overlay.style.top = `${coords.bottom - editorRect.top + view.scrollDOM.scrollTop}px`;
  overlay.style.left = `${coords.left - editorRect.left}px`;

  const chips = document.createElement("div");
  chips.className = "mention-chips";
  overlay.appendChild(chips);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cmdk-prompt-input";
  input.placeholder = "Describe the edit… (@file, Enter, Esc)";
  input.spellcheck = false;

  detachMention = attachMentionAutocomplete(
    input,
    chips,
    ctx.workspaceRoot,
    () => {},
  );

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const value = input.value.trim();
      if (value) {
        removePromptOverlay();
        void runStream(view, promptState, value);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      removePromptOverlay();
      ctx.onStatus("Cancelled");
    }
  });

  overlay.appendChild(input);
  view.dom.appendChild(overlay);
  input.focus();
}

function removePromptOverlay() {
  detachMention?.();
  detachMention = null;
  document.getElementById("cmdk-prompt-overlay")?.remove();
}

async function parseAndReview(
  view: EditorView,
  _promptState: PromptState,
  rawOutput: string,
): Promise<void> {
  const ctx = cmdkContext;
  if (!ctx) {
    return;
  }

  clearGhostPreview(view);

  try {
    const patch = await invoke<Patch>("parse_patch", {
      request: {
        raw_llm_output: rawOutput,
        file_path: ctx.filePath || "untitled",
        file_content: view.state.doc.toString(),
      },
    });
    enterDiffReview(view, patch);
    ctx.onStatus(
      `Review: all ${patch.hunks.length} hunks selected — Space/Tab toggle, Alt+↑↓ navigate, Enter apply`,
    );
  } catch (err) {
    const message = String(err);
    ctx.onStatus(`Patch parse failed: ${message} — Cmd+K to retry`);
  }
}

async function runStream(
  view: EditorView,
  promptState: PromptState,
  instruction: string,
) {
  const ctx = cmdkContext;
  if (!ctx) {
    return;
  }

  lastPromptState = promptState;
  lastInstruction = instruction;

  const requestId = newRequestId();
  ctx.onStreamingChange(true);
  ctx.onStatus("Streaming…");

  setGhostPreview(view, { anchor: promptState.to, text: "" });

  const mentions = getMentions().filter(
    (m): m is import("../llm/config").MentionRequest => m.kind !== "changes",
  );

  const messages = buildCmdkMessages(
    ctx.filePath || "untitled",
    promptState.selection,
    instruction,
    mentions,
  );

  await startStream(
    {
      request_id: requestId,
      messages,
    },
    {
      onStart: () => {
        ctx.onStatus("Waiting for first token…");
      },
      onDelta: (_delta, fullText) => {
        setGhostPreview(view, { anchor: promptState.to, text: fullText });
        ctx.onStatus("Streaming…");
      },
      onDone: (fullText) => {
        ctx.onStreamingChange(false);
        void parseAndReview(view, promptState, fullText);
      },
      onError: (message) => {
        clearGhostPreview(view);
        ctx.onStreamingChange(false);
        ctx.onStatus(`Stream error: ${message}`);
      },
    },
  );
}

export function handleCmdK(view: EditorView): boolean {
  const ctx = cmdkContext;
  if (!ctx) {
    return false;
  }

  if (isStreaming()) {
    void cancelActiveStream(view);
    return true;
  }

  if (isDiffReviewActive(view)) {
    return true;
  }

  const { from, to, empty } = view.state.selection.main;
  if (empty) {
    ctx.onStatus("Select code first, then press Cmd+K");
    return true;
  }

  const selection = view.state.sliceDoc(from, to);
  showPromptOverlay(view, to, { from, to, selection });
  return true;
}

export async function cancelActiveStream(view: EditorView): Promise<void> {
  const ctx = cmdkContext;
  const id = currentRequestId();
  if (!id) {
    return;
  }

  await cancelStream(id);
  clearGhostPreview(view);
  removePromptOverlay();
  ctx?.onStreamingChange(false);
  ctx?.onStatus("Stream cancelled");
}

export async function cancelDiffReview(view: EditorView): Promise<void> {
  const ctx = cmdkContext;
  if (isAgentHitlActive()) {
    await rejectAgentHitl(view);
    ctx?.onStatus("Patch rejected — agent notified");
    return;
  }
  if (await rejectPendingHitlFromUi()) {
    ctx?.onStatus("Patch rejected — agent notified");
    return;
  }
  await rejectCurrentPatch(view);
  ctx?.onStatus("Patch rejected");
}

export async function applyDiffReview(view: EditorView): Promise<void> {
  const ctx = cmdkContext;
  if (!ctx) {
    return;
  }

  if (isAgentHitlActive()) {
    const newContent = await applyAgentHitl(view);
    if (newContent === null) {
      ctx.onStatus("Select at least one hunk to apply");
      return;
    }
    ctx.onApplyPatch?.(newContent, ctx.filePath);
    ctx.onStatus("Patch applied — agent resumed");
    return;
  }

  const newContent = await applyAcceptedHunks(view);
  if (newContent === null) {
    ctx.onStatus("Select at least one hunk to apply");
    return;
  }

  ctx.onApplyPatch?.(newContent, ctx.filePath);
  ctx.onStatus("Patch applied");
}

export function handleEscape(view: EditorView): boolean {
  if (document.getElementById("cmdk-prompt-overlay")) {
    removePromptOverlay();
    cmdkContext?.onStatus("Cancelled");
    return true;
  }

  if (isStreaming()) {
    void cancelActiveStream(view);
    return true;
  }

  if (isDiffReviewActive(view)) {
    void cancelDiffReview(view);
    return true;
  }

  return false;
}

export function retryLastStream(view: EditorView): void {
  if (lastPromptState && lastInstruction) {
    void runStream(view, lastPromptState, lastInstruction);
  }
}
