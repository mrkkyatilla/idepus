import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  clearInlineGhost,
  setInlineGhost,
  setInlineGhostEnabled,
} from "../editor/inline-ghost";
import { isDiffReviewActive } from "../cmdk/diff-review";
import { isStreaming } from "../llm/stream-client";
import {
  autocompleteSuggest,
  getAutocompleteConfig,
  ollamaHealthCheck,
} from "./config";
import { languageFromPath, shouldSuggestForPath } from "./should-suggest";

let paused = false;
let configEnabled = false;
let debounceMs = 250;
let provider: "mock" | "ollama" = "mock";
let ollamaAvailable = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let requestGeneration = 0;
let configLoaded = false;
let warnedOllamaMissing = false;

export async function refreshAutocompleteConfig(): Promise<void> {
  try {
    const cfg = await getAutocompleteConfig();
    configEnabled = cfg.enabled;
    debounceMs = Math.min(500, Math.max(200, cfg.debounce_ms || 250));
    provider = cfg.provider;
    if (provider === "ollama") {
      const health = await ollamaHealthCheck();
      ollamaAvailable = health.available;
    } else {
      ollamaAvailable = true;
    }
    configLoaded = true;
  } catch {
    configEnabled = false;
    configLoaded = true;
  }
}

function isDiffReviewActiveSafe(view: EditorView): boolean {
  try {
    return isDiffReviewActive(view);
  } catch {
    return false;
  }
}

function isActive(): boolean {
  if (!configLoaded || !configEnabled || paused) {
    return false;
  }
  if (provider === "ollama" && !ollamaAvailable) {
    return false;
  }
  return true;
}

function cancelPending(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  requestGeneration += 1;
}

export function pauseAutocomplete(view?: EditorView | null): void {
  paused = true;
  cancelPending();
  if (view) {
    clearInlineGhost(view);
    setInlineGhostEnabled(view, false);
  }
}

export function resumeAutocomplete(view?: EditorView | null): void {
  paused = false;
  if (view) {
    setInlineGhostEnabled(view, true);
  }
}

async function runSuggest(
  view: EditorView,
  filePath: string,
  generation: number,
): Promise<void> {
  if (generation !== requestGeneration || !isActive()) {
    return;
  }
  if (isStreaming() || isDiffReviewActiveSafe(view)) {
    clearInlineGhost(view);
    return;
  }

  const cursor = view.state.selection.main.head;
  const doc = view.state.doc.toString();
  const prefix = doc.slice(0, cursor);
  const suffix = doc.slice(cursor);

  if (prefix.trim().length < 2) {
    clearInlineGhost(view);
    return;
  }

  try {
    const result = await autocompleteSuggest({
      prefix,
      suffix,
      file_path: filePath,
      language: languageFromPath(filePath),
      cursor_offset: cursor,
    });
    if (generation !== requestGeneration || !isActive()) {
      return;
    }
    if (!result?.text?.trim()) {
      clearInlineGhost(view);
      return;
    }
    const currentCursor = view.state.selection.main.head;
    setInlineGhost(view, { from: currentCursor, text: result.text });
  } catch {
    if (provider === "ollama" && !warnedOllamaMissing) {
      warnedOllamaMissing = true;
      ollamaAvailable = false;
      if (typeof document !== "undefined") {
        const status = document.querySelector<HTMLElement>("#status-message");
        if (status && !status.textContent?.includes("Ollama")) {
          status.textContent =
            "Inline autocomplete needs local Ollama — enable Mock in Settings or start Ollama.";
        }
      }
    }
    clearInlineGhost(view);
  }
}

function scheduleSuggest(view: EditorView, filePath: string): void {
  cancelPending();
  if (!isActive()) {
    clearInlineGhost(view);
    return;
  }
  if (!shouldSuggestForPath(filePath)) {
    clearInlineGhost(view);
    return;
  }
  if (isStreaming() || isDiffReviewActiveSafe(view)) {
    clearInlineGhost(view);
    return;
  }

  const generation = requestGeneration;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSuggest(view, filePath, generation);
  }, debounceMs);
}

export function autocompleteControllerExtension(
  getFilePath: () => string,
): Extension {
  void refreshAutocompleteConfig();

  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) {
      return;
    }
    scheduleSuggest(update.view, getFilePath());
  });
}

/** @internal test helper */
export function __testIsAutocompleteActive(): boolean {
  return isActive();
}

/** @internal test helper */
export function __testResetController(): void {
  paused = false;
  requestGeneration = 0;
  configLoaded = false;
  configEnabled = false;
  warnedOllamaMissing = false;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** @internal test helper */
export function __testScheduleSuggest(view: EditorView, filePath: string): void {
  scheduleSuggest(view, filePath);
}
