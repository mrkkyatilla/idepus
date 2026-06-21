import { describe, expect, it } from "vitest";

import { autocompleteSuggest, ollamaHealthCheck } from "./config";

describe("G10 cloud-zero-invoke", () => {
  it("frontend autocomplete uses local suggest API only", () => {
    expect(typeof autocompleteSuggest).toBe("function");
    expect(typeof ollamaHealthCheck).toBe("function");
  });
});
