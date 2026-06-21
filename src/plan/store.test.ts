import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildImplementChatSummary,
  buildImplementPrompt,
  clearActivePlan,
  extractPlanMarkdown,
  extractPlanReferences,
  ensurePlanReadyForImplement,
  getActivePlanDocument,
  isPlanUnsavedDraft,
  loadPlanDraft,
  planApprovalRequired,
} from "./store";

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
  });
});

describe("plan store helpers", () => {
  it("builds implement prompt with plan body", () => {
    const prompt = buildImplementPrompt("# Plan\n- [ ] step 1");
    expect(prompt).toContain("Implement the following approved plan");
    expect(prompt).toContain("# Plan");
    expect(prompt).toContain("References from plan must be read");
  });

  it("extracts reference paths from plan markdown", () => {
    const md =
      "# Plan: X\n## References\n- src/foo.ts (L1–10)\n- `bar.py`\n";
    expect(extractPlanReferences(md)).toContain("src/foo.ts");
    expect(buildImplementChatSummary("Auth refactor")).toBe(
      "Implement plan: **Auth refactor**",
    );
  });

  it("includes reference pre-read list in implement prompt", () => {
    const md =
      "# Plan: X\n## Steps\n- [ ] a\n## References\n- src/util.ts\n";
    const prompt = buildImplementPrompt(md);
    expect(extractPlanReferences(md)).toContain("src/util.ts");
    expect(prompt).toContain("Pre-read these plan reference files");
    expect(prompt).toContain("src/util.ts");
  });

  it("requires approval by default", () => {
    expect(planApprovalRequired()).toBe(true);
  });

  it("extracts plan markdown from assistant text", () => {
    const text = "# Plan: Auth refactor\n## Summary\nok\n## Steps\n- [ ] a\n";
    const parsed = extractPlanMarkdown(text);
    expect(parsed?.title).toBe("Auth refactor");
    expect(parsed?.content).toContain("## Steps");
  });

  it("extracts plan when prefixed with save notice", () => {
    const text =
      "Plan saved to `.idepus/plans/abc.md`.\n\n# Plan: Auth refactor\n## Summary\nok\n";
    const parsed = extractPlanMarkdown(text);
    expect(parsed?.title).toBe("Auth refactor");
    expect(parsed?.content.startsWith("# Plan:")).toBe(true);
  });

  it("loadPlanDraft marks unsaved state", () => {
    loadPlanDraft("Test", "# Plan: Test\n## Summary\nx\n");
    expect(isPlanUnsavedDraft()).toBe(true);
    expect(getActivePlanDocument()?.meta.title).toBe("Test");
  });

  it("clearActivePlan resets editor state", () => {
    loadPlanDraft("Test", "# Plan: Test\n## Summary\nx\n");
    clearActivePlan();
    expect(getActivePlanDocument()).toBeNull();
    expect(isPlanUnsavedDraft()).toBe(false);
  });

  it("ensurePlanReadyForImplement passes when approval not required", async () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "idepus.plan.requireApproval" ? "0" : null,
      setItem: () => {},
    });
    loadPlanDraft("Ship it", "# Plan: Ship it\n## Summary\nx\n## Steps\n- [ ] a\n");
    await expect(ensurePlanReadyForImplement()).resolves.toBe(true);
  });
});
