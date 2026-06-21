import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launchAgentRun: vi.fn(),
  ensurePlanReadyForImplement: vi.fn(),
  getActivePlanDocument: vi.fn(),
  buildImplementPrompt: vi.fn(),
  buildImplementChatSummary: vi.fn(),
  markPlanImplementing: vi.fn(),
  setAgentMode: vi.fn(),
  updateActiveSessionMode: vi.fn(),
  getActiveRunId: vi.fn(),
}));

vi.mock("../../agent/run-launcher", () => ({
  launchAgentRun: mocks.launchAgentRun,
}));

vi.mock("../../agent/client", () => ({
  getActiveRunId: mocks.getActiveRunId,
}));

vi.mock("../../agent/mode", () => ({
  setAgentMode: mocks.setAgentMode,
}));

vi.mock("../../chat/session-store", () => ({
  updateActiveSessionMode: mocks.updateActiveSessionMode,
}));

vi.mock("../../plan/store", () => ({
  ensurePlanReadyForImplement: mocks.ensurePlanReadyForImplement,
  getActivePlanDocument: mocks.getActivePlanDocument,
  buildImplementPrompt: mocks.buildImplementPrompt,
  buildImplementChatSummary: mocks.buildImplementChatSummary,
  markPlanImplementing: mocks.markPlanImplementing,
  approveActivePlan: vi.fn(),
  rejectActivePlan: vi.fn(),
  saveActivePlan: vi.fn(),
  subscribePlanStore: vi.fn(() => () => {}),
  getPlanSaveError: vi.fn(),
  isPlanDirty: vi.fn(),
  isPlanUnsavedDraft: vi.fn(),
  setPlanEditorContent: vi.fn(),
}));

import { implementActivePlan } from "./plan-split";

describe("implementActivePlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensurePlanReadyForImplement.mockResolvedValue(true);
    mocks.getActivePlanDocument.mockReturnValue({
      meta: { id: "plan-1", title: "Auth plan", status: "approved" },
      content: "# Plan: Auth\n## Steps\n- [ ] a\n",
    });
    mocks.buildImplementPrompt.mockReturnValue("FULL AGENT PROMPT");
    mocks.buildImplementChatSummary.mockReturnValue("Implement plan: **Auth plan**");
    mocks.launchAgentRun.mockResolvedValue(true);
    mocks.getActiveRunId.mockReturnValue("run-impl-1");
  });

  it("sends short chat summary and full prompt to launcher", async () => {
    const onStatus = vi.fn();
    await implementActivePlan(
      {
        workspaceRoot: "/tmp/ws",
        getEditorView: () => null,
        openFile: async () => {},
        onStatus,
      },
      onStatus,
    );

    expect(mocks.launchAgentRun).toHaveBeenCalledWith(
      "FULL AGENT PROMPT",
      expect.objectContaining({ agentId: "multi-file-editor" }),
      expect.objectContaining({
        chatDisplay: "Implement plan: **Auth plan**",
        launchMode: "agent",
      }),
    );
    expect(mocks.setAgentMode).toHaveBeenCalledWith("agent");
    expect(mocks.markPlanImplementing).toHaveBeenCalledWith("plan-1", "run-impl-1");
  });

  it("reverts to plan mode when launch fails", async () => {
    mocks.launchAgentRun.mockResolvedValue(false);
    const onStatus = vi.fn();
    await implementActivePlan(
      {
        workspaceRoot: "/tmp/ws",
        getEditorView: () => null,
        openFile: async () => {},
        onStatus,
      },
      onStatus,
    );

    expect(mocks.setAgentMode).toHaveBeenCalledWith("agent");
    expect(mocks.setAgentMode).toHaveBeenCalledWith("plan");
    expect(mocks.markPlanImplementing).not.toHaveBeenCalled();
  });
});
