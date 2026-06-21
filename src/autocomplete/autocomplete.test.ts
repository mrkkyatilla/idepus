// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";

import {
  acceptInlineGhost,
  clearInlineGhost,
  getInlineGhost,
  inlineGhostExtension,
  setInlineGhost,
} from "../editor/inline-ghost";

const suggestMock = vi.fn();

vi.mock("./config", () => ({
  getAutocompleteConfig: vi.fn().mockResolvedValue({
    enabled: true,
    provider: "mock",
    debounce_ms: 250,
    model: "mock",
  }),
  autocompleteSuggest: (...args: unknown[]) => suggestMock(...args),
  ollamaHealthCheck: vi.fn().mockResolvedValue({
    available: false,
    models: [],
    gpu_detected: false,
    message: "unavailable",
  }),
}));

vi.mock("../cmdk/diff-review", () => ({
  isDiffReviewActive: () => false,
}));

vi.mock("../llm/stream-client", () => ({
  isStreaming: () => false,
}));

import {
  refreshAutocompleteConfig,
  resumeAutocomplete,
  __testIsAutocompleteActive,
  __testResetController,
  __testScheduleSuggest,
} from "./controller";

function mountView(doc = "fn "): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    doc,
    extensions: inlineGhostExtension(),
  });
}

describe("inline ghost", () => {
  let view: EditorView;

  beforeEach(() => {
    view = mountView();
  });

  afterEach(() => {
    view.destroy();
  });

  it("Tab accept inserts ghost text at cursor", () => {
    const pos = view.state.doc.length;
    setInlineGhost(view, { from: pos, text: "main() {}" });
    expect(getInlineGhost(view)?.text).toBe("main() {}");

    const accepted = acceptInlineGhost(view);
    expect(accepted).toBe(true);
    expect(view.state.doc.toString()).toBe("fn main() {}");
    expect(getInlineGhost(view)).toBeNull();
  });

  it("clears ghost on doc change", () => {
    const pos = view.state.doc.length;
    setInlineGhost(view, { from: pos, text: "x" });
    view.dispatch(view.state.update({ changes: { from: pos, insert: "a" } }));
    expect(getInlineGhost(view)).toBeNull();
  });

  it("clearInlineGhost removes suggestion", () => {
    setInlineGhost(view, { from: 3, text: "ghost" });
    clearInlineGhost(view);
    expect(getInlineGhost(view)).toBeNull();
  });
});

describe("autocomplete controller debounce", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    __testResetController();
    suggestMock.mockClear();
    suggestMock.mockResolvedValue({
      text: "main()",
      model: "mock",
      latency_ms: 1,
    });
    resumeAutocomplete();
    await refreshAutocompleteConfig();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads config as active for mock provider", () => {
    expect(__testIsAutocompleteActive()).toBe(true);
  });

  it("mock suggest API is wired", async () => {
    const { autocompleteSuggest } = await import("./config");
    await autocompleteSuggest({
      prefix: "hello",
      suffix: "",
      file_path: "src/main.rs",
      language: "rust",
      cursor_offset: 5,
    });
    expect(suggestMock).toHaveBeenCalledTimes(1);
  });

  it("does not invoke suggest before debounce elapses", () => {
    const view = mountView("hello world");
    __testScheduleSuggest(view, "src/main.rs");
    expect(suggestMock).not.toHaveBeenCalled();
    view.destroy();
  });

  it("reschedule keeps suggest pending until debounce completes", () => {
    const view = mountView("hello world");
    __testScheduleSuggest(view, "src/main.rs");
    __testScheduleSuggest(view, "src/main.rs");
    expect(suggestMock).not.toHaveBeenCalled();
    view.destroy();
  });
});
