import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../chat/types";
import { formatWorkingMessages } from "./compose";

describe("formatWorkingMessages", () => {
  it("includes recent conversation roles", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "user", content: "edit test.md", createdAt: 1 },
      { id: "2", role: "assistant", content: "Opening patch review", createdAt: 2 },
      { id: "3", role: "user", content: "sadece test.md ile ilgilen", createdAt: 3 },
    ];
    const block = formatWorkingMessages(messages);
    expect(block).toContain("[Recent conversation]");
    expect(block).toContain("user: edit test.md");
    expect(block).toContain("sadece test.md ile ilgilen");
  });
});
