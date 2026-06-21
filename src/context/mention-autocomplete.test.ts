import { beforeEach, describe, expect, it } from "vitest";

import {
  addMention,
  getMentions,
  relWorkspacePath,
  resetMentionsForPrompt,
} from "./mention-autocomplete";

beforeEach(() => {
  resetMentionsForPrompt();
});

describe("addMention", () => {
  it("adds file mention with relative path", () => {
    expect(addMention({ kind: "file", path: "src/foo.ts" })).toBe(true);
    expect(getMentions()).toEqual([{ kind: "file", path: "src/foo.ts" }]);
  });

  it("deduplicates same path and kind", () => {
    addMention({ kind: "file", path: "src/foo.ts" });
    expect(addMention({ kind: "file", path: "src/foo.ts" })).toBe(false);
    expect(getMentions()).toHaveLength(1);
  });

  it("normalizes folder paths without trailing slash", () => {
    addMention({ kind: "folder", path: "src/components/" });
    expect(getMentions()[0]?.path).toBe("src/components");
  });

  it("clears mentions on reset", () => {
    addMention({ kind: "file", path: "a.ts" });
    resetMentionsForPrompt();
    expect(getMentions()).toHaveLength(0);
  });
});

describe("relWorkspacePath", () => {
  it("converts absolute path to relative", () => {
    expect(relWorkspacePath("/workspace/src/app.ts", "/workspace")).toBe(
      "src/app.ts",
    );
  });

  it("returns null for paths outside workspace", () => {
    expect(relWorkspacePath("/other/file.ts", "/workspace")).toBeNull();
  });
});
