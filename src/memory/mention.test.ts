import { describe, expect, it } from "vitest";

import {
  extractFilenameHints,
  formatChangesMentionBlock,
  formatTargetFilesBlock,
} from "../context/mention-autocomplete";

describe("formatChangesMentionBlock", () => {
  it("formats recent changes", () => {
    const block = formatChangesMentionBlock([
      {
        path: "src/auth.ts",
        summary: "Refactored auth module",
        acceptedAt: Date.now(),
      },
    ]);
    expect(block).toContain("src/auth.ts");
    expect(block).toContain("Refactored auth module");
  });

  it("handles empty list", () => {
    expect(formatChangesMentionBlock([])).toContain("none");
  });
});

describe("formatTargetFilesBlock", () => {
  it("includes @mentions and filename hints from the task", () => {
    const block = formatTargetFilesBlock("test.md dosyasını düzenle", [
      { kind: "file", path: "test.md" },
    ]);
    expect(block).toContain("[Target files]");
    expect(block).toContain("- test.md");
  });

  it("extracts filenames from Turkish edit requests", () => {
    expect(extractFilenameHints("test.md dosyasını düzenle")).toEqual(["test.md"]);
    expect(extractFilenameHints("test dosyasına yaz")).toEqual(["test.md"]);
    expect(extractFilenameHints("@test.md dosyasına yaz")).toEqual(["test.md"]);
  });

  it("extracts scope-only file references", () => {
    expect(extractFilenameHints("only focus on test.md")).toEqual(["test.md"]);
    expect(extractFilenameHints("sadece test ile ilgilen")).toEqual(["test.md"]);
    expect(extractFilenameHints("only focus on test")).toEqual(["test.md"]);
  });

  it("ignores triple-backtick code blocks for hints", () => {
    const hints = extractFilenameHints(
      'write ```python\nprint("hello")\n``` in other.py',
    );
    expect(hints).toContain("other.py");
    expect(hints.some((h) => h.includes("python"))).toBe(false);
  });
});
