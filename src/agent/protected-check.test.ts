import { describe, expect, it } from "vitest";

import { findProtectedViolations } from "./protected-check";

describe("protected-check", () => {
  it("matches exact path", () => {
    const hits = findProtectedViolations("src/core/main.ts", {
      architecture: [],
      protected_patterns: ["src/core/**"],
      preferred_libraries: [],
    });
    expect(hits).toEqual(["src/core/**"]);
  });

  it("returns empty when no match", () => {
    const hits = findProtectedViolations("src/util.ts", {
      architecture: [],
      protected_patterns: ["src/core/**"],
      preferred_libraries: [],
    });
    expect(hits).toHaveLength(0);
  });
});
