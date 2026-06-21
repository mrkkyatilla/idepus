import { describe, expect, it, vi } from "vitest";

import { isPatchReviewOpening } from "./hitl-flow";

vi.mock("./hitl", () => ({
  enterDiffReviewFromApproval: vi.fn(async () => {}),
}));

describe("hitl-flow mutex", () => {
  it("reports opening state", () => {
    expect(isPatchReviewOpening()).toBe(false);
  });
});
