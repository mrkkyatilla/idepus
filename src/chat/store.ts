import {
  subscribeChatSessions,
  getChatMessages,
  addUserMessage,
  startAssistantStream,
  appendAssistantToken,
  finalizeAssistantStream,
  addAssistantMessage,
  hydrateChatMessages,
  flushSave,
} from "./session-store";

export const subscribeChat = subscribeChatSessions;

export {
  getChatMessages,
  addUserMessage,
  startAssistantStream,
  appendAssistantToken,
  finalizeAssistantStream,
  addAssistantMessage,
  hydrateChatMessages,
};

export function clearChatSession(): void {
  hydrateChatMessages([]);
  void flushSave();
}
