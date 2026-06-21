// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountChatTranscript } from "./chat-transcript";

const messages: Array<{
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  createdAt: number;
  activity?: Array<{
    id: string;
    label: string;
    status: "running" | "done" | "error";
  }>;
}> = [];

vi.mock("../../chat/store", () => ({
  getChatMessages: () => messages,
  subscribeChat: (listener: () => void) => {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  },
}));

let listeners: Array<() => void> = [];

function notify(): void {
  for (const l of listeners) {
    l();
  }
}

describe("mountChatTranscript", () => {
  beforeEach(() => {
    messages.length = 0;
    listeners = [];
    document.body.innerHTML = "";
  });

  it("renders assistant markdown incrementally while streaming", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountChatTranscript(host);

    messages.push({
      id: "a1",
      role: "assistant",
      content: "**Hello**",
      streaming: true,
      createdAt: Date.now(),
    });
    notify();
    await new Promise((r) => requestAnimationFrame(r));

    const body = host.querySelector(".chat-message-body");
    expect(body?.querySelector("strong")?.textContent).toBe("Hello");

    messages[0]!.content = "**Hello** world";
    notify();
    await new Promise((r) => requestAnimationFrame(r));

    expect(body?.textContent).toContain("world");
    expect(host.querySelectorAll(".chat-message").length).toBe(1);
  });

  it("renders plan activity as info boxes with status icons", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountChatTranscript(host);

    messages.push({
      id: "a-plan",
      role: "assistant",
      content: "",
      streaming: true,
      createdAt: Date.now(),
      activity: [
        {
          id: "1",
          label: "Exploring codebase and drafting plan",
          status: "done",
        },
        { id: "2", label: "Gathering context", status: "done" },
        { id: "3", label: "Exploring codebase", status: "running" },
      ],
    });
    notify();
    await new Promise((r) => requestAnimationFrame(r));

    const items = host.querySelectorAll(".agent-activity-item");
    expect(items.length).toBe(3);
    expect(host.querySelector(".agent-activity-item--done .agent-activity-item__icon")?.textContent).toBe("✓");
    expect(host.querySelector(".agent-activity-item--running")).toBeTruthy();
    expect(host.querySelector(".chat-message-body")?.hidden).toBe(true);
  });

  it("removes message nodes when session clears", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountChatTranscript(host);

    messages.push({
      id: "u1",
      role: "user",
      content: "hi",
      createdAt: Date.now(),
    });
    notify();
    expect(host.querySelectorAll(".chat-message").length).toBe(1);

    messages.length = 0;
    notify();
    expect(host.querySelector(".chat-empty")).toBeTruthy();
    expect(host.querySelectorAll(".chat-message").length).toBe(0);
  });
});
