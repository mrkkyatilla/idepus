import { describe, expect, it } from "vitest";

import { parentDir, joinPath } from "./fs";

describe("workspace fs helpers", () => {
  it("joinPath uses platform-like separator from base dir", () => {
    expect(joinPath("C:\\project\\src", "file.ts")).toBe(
      "C:\\project\\src\\file.ts",
    );
  });

  it("parentDir handles single segment", () => {
    expect(parentDir("file.ts")).toBe("file.ts");
  });
});
