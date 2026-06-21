import { beforeEach, describe, expect, it, vi } from "vitest";

const listChatSessions = vi.fn();
const loadChatSession = vi.fn();
const saveChatSession = vi.fn();
const saveWorkspaceSessionIndex = vi.fn();

vi.mock("./persist", () => ({
  listChatSessions,
  loadChatSession,
  saveChatSession,
  saveWorkspaceSessionIndex,
  deleteChatSession: vi.fn(),
}));

vi.mock("../agent/mode", () => ({
  getAgentMode: () => "agent",
  saveAgentMode: vi.fn(),
}));

vi.mock("../agent/patch-queue", () => ({
  getPatchQueue: () => [],
  hydratePatchQueue: vi.fn(),
}));

describe("session-store history", () => {
  beforeEach(() => {
    vi.resetModules();
    listChatSessions.mockReset();
    loadChatSession.mockReset();
    saveChatSession.mockReset();
    saveWorkspaceSessionIndex.mockReset();
  });

  it("sorts workspace session summaries by updatedAt desc", async () => {
    listChatSessions.mockResolvedValue({
      workspaceId: "ws-1",
      sessions: [
        { id: "a", title: "Older", mode: "agent", updatedAt: 100 },
        { id: "b", title: "Newer", mode: "plan", updatedAt: 200 },
      ],
      openSessionIds: ["a"],
      activeSessionId: "a",
    });

    const { initChatSessionsForWorkspace, getWorkspaceSessionSummaries } =
      await import("./session-store");

    await initChatSessionsForWorkspace("ws-1");
    const summaries = await getWorkspaceSessionSummaries();

    expect(summaries.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("openSessionFromHistory loads a session that is not in memory", async () => {
    listChatSessions.mockResolvedValue({
      workspaceId: "ws-1",
      sessions: [
        { id: "active", title: "Active", mode: "agent", updatedAt: 300 },
        { id: "stored", title: "Stored", mode: "ask", updatedAt: 200 },
      ],
      openSessionIds: ["active"],
      activeSessionId: "active",
    });

    loadChatSession.mockImplementation(async (_ws: string, id: string) => {
      if (id === "active") {
        return {
          id: "active",
          title: "Active",
          mode: "agent",
          messages: [],
          workspaceId: "ws-1",
          createdAt: 1,
          updatedAt: 300,
        };
      }
      if (id === "stored") {
        return {
          id: "stored",
          title: "Stored",
          mode: "ask",
          messages: [{ id: "m1", role: "user", content: "hi", createdAt: 1 }],
          workspaceId: "ws-1",
          createdAt: 1,
          updatedAt: 200,
        };
      }
      return null;
    });

    const {
      initChatSessionsForWorkspace,
      openSessionFromHistory,
      getActiveSessionId,
      getActiveSession,
    } = await import("./session-store");

    await initChatSessionsForWorkspace("ws-1");
    expect(getActiveSessionId()).toBe("active");

    const ok = await openSessionFromHistory("stored");
    expect(ok).toBe(true);
    expect(getActiveSessionId()).toBe("stored");
    expect(getActiveSession()?.title).toBe("Stored");
    expect(loadChatSession).toHaveBeenCalledWith("ws-1", "stored");
  });
});
