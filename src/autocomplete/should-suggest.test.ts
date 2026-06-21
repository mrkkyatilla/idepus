import { describe, expect, it } from "vitest";

import { shouldSuggestForPath } from "./should-suggest";

describe("shouldSuggestForPath", () => {
  it("ignores markdown and json", () => {
    expect(shouldSuggestForPath("README.md")).toBe(false);
    expect(shouldSuggestForPath("package.json")).toBe(false);
  });

  it("ignores node_modules and dist", () => {
    expect(shouldSuggestForPath("node_modules/foo/index.ts")).toBe(false);
    expect(shouldSuggestForPath("dist/bundle.js")).toBe(false);
  });

  it("allows source files", () => {
    expect(shouldSuggestForPath("src/main.rs")).toBe(true);
    expect(shouldSuggestForPath("src/app.ts")).toBe(true);
  });
});
