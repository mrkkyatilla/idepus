import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "list_chat_sessions") {
      return {
        workspaceId: "test-ws",
        sessions: [],
        openSessionIds: [],
      };
    }
    if (cmd === "save_chat_session") {
      return null;
    }
    if (cmd === "save_workspace_session_index") {
      return null;
    }
    return null;
  }),
}));

import {
  addUserMessage,
  getChatMessages,
  hydrateChatMessages,
  initChatSessionsForWorkspace,
} from "./session-store";
import { clearChatSession } from "./store";

beforeEach(async () => {
  await initChatSessionsForWorkspace("test-ws");
  clearChatSession();
});

describe("chat session store", () => {
  it("adds user messages", () => {
    addUserMessage("hello");
    expect(getChatMessages()).toHaveLength(1);
    expect(getChatMessages()[0]?.role).toBe("user");
  });

  it("hydrates from snapshot", () => {
    hydrateChatMessages([
      {
        id: "m1",
        role: "assistant",
        content: "restored",
        createdAt: Date.now(),
      },
    ]);
    expect(getChatMessages()[0]?.content).toBe("restored");
  });
});
