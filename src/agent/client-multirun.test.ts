import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("client multirun", () => {
  it("getActiveRunId delegates to foreground registry", async () => {
    const { setForegroundRun } = await import("./run-registry");
    const { getActiveRunId } = await import("./client");
    setForegroundRun("run-a");
    expect(getActiveRunId()).toBe("run-a");
    setForegroundRun(null);
  });
});
