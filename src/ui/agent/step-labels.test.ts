import { describe, expect, it } from "vitest";

import { stepChipType } from "./step-labels";

describe("stepChipType", () => {
  it("maps gather to read", () => {
    expect(stepChipType("gather")).toBe("read");
  });

  it("maps approval to waiting", () => {
    expect(stepChipType("approval_required")).toBe("waiting");
  });

  it("maps propose_patch to editing", () => {
    expect(stepChipType("propose_patch")).toBe("editing");
  });

  it("maps explore-planner nodes", () => {
    expect(stepChipType("explore_loop")).toBe("explore");
    expect(stepChipType("planning_next_moves")).toBe("planning");
    expect(stepChipType("write_plan")).toBe("planning");
  });
});
