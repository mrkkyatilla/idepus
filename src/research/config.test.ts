import { describe, expect, it } from "vitest";

import { stepChipType } from "../ui/agent/step-labels";

describe("research step chips", () => {
  it("maps web_search to research chip", () => {
    expect(stepChipType("web_search")).toBe("research");
    expect(stepChipType("research")).toBe("research");
    expect(stepChipType("fetch_url")).toBe("research");
  });
});
