import { describe, expect, it } from "vitest";

import {
  extractInsertFromTask,
  patchTextForReview,
} from "./patch-fallback";

describe("patch-fallback", () => {
  it("extracts quoted insert text from Turkish task", () => {
    const task = '@test.md dosyasına "#agent wrote this" yazar mısın';
    expect(extractInsertFromTask(task)).toBe("#agent wrote this");
  });

  it("rewrites mock patch using the user task", () => {
    const raw = [
      "<<<<<<< SEARCH",
      "=======",
      "# agent: mock edit",
      ">>>>>>> REPLACE",
    ].join("\n");
    const task = 'test.md dosyasına "#agent wrote this" yazar mısın';
    const patched = patchTextForReview(raw, "", task);
    expect(patched).toContain("#agent wrote this");
    expect(patched).not.toContain("# agent: mock edit");
  });
});
