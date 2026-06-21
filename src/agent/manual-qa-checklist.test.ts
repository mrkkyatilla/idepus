import { describe, it } from "vitest";

/**
 * Manual QA checklist (esite workspace). Run these after agent/HITL changes.
 */
describe.skip("manual QA — agent context, mock patch, HITL", () => {
  it("1. API key + ./scripts/aicery-reload-provider.sh → agent panel shows real provider (not Mock)", () => {});
  it("2. @test.md + Python calculator in triple quotes → real code patch, not # agent: mock edit", () => {});
  it("3. Turn 1: write calculator to test.md → Turn 2: sadece test.md ile ilgilen → only test.md targeted", () => {});
  it("4. Apply first patch → second patch on same file opens diff with current editor base", () => {});
  it("5. Mock mode (no API key) → banner + transcript mock notice; invalid LLM does not silently mock", () => {});
});
