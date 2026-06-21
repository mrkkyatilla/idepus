import { getChatMessages, subscribeChat } from "../../chat/store";
import type { ActivityEntry, ChatMessage } from "../../chat/types";
import { mountMarkdown, type MarkdownMount } from "../../chat/markdown";
import type { ContextHits } from "../../memory/types";
import { syncActivityFeed } from "./activity-feed";

export type ChatTranscriptMount = {
  scrollToBottom: () => void;
};

type MessageNode = {
  bubble: HTMLDivElement;
  body: HTMLDivElement;
  activityHost: HTMLDivElement | null;
  cursor: HTMLSpanElement | null;
  citations: HTMLDivElement | null;
  mdMount: MarkdownMount | null;
  lastContent: string;
  lastActivity: ActivityEntry[] | null;
  streaming: boolean;
};

function renderCitations(
  hits: ContextHits,
  onCitation?: (kind: "memory" | "change", id: string) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "context-citations";

  for (const m of hits.memories ?? []) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "context-citation-chip context-citation-chip--memory";
    chip.textContent = `${m.type}: ${m.text.slice(0, 48)}${m.text.length > 48 ? "…" : ""}`;
    chip.title = m.text;
    chip.addEventListener("click", () => onCitation?.("memory", m.id));
    row.appendChild(chip);
  }

  for (const c of hits.changes ?? []) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "context-citation-chip context-citation-chip--change";
    chip.textContent = `${c.path}`;
    chip.title = c.summary;
    chip.addEventListener("click", () => onCitation?.("change", c.id));
    row.appendChild(chip);
  }

  return row;
}

function syncActivity(
  node: MessageNode,
  msg: ChatMessage,
): void {
  const entries = msg.activity ?? [];
  if (entries.length === 0) {
    if (node.activityHost) {
      node.activityHost.remove();
      node.activityHost = null;
      node.lastActivity = null;
    }
    return;
  }

  const same =
    node.lastActivity &&
    node.lastActivity.length === entries.length &&
    node.lastActivity.every(
      (entry, index) =>
        entry.id === entries[index]?.id &&
        entry.status === entries[index]?.status &&
        entry.label === entries[index]?.label,
    );
  if (same) {
    return;
  }

  if (!node.activityHost) {
    node.activityHost = document.createElement("div");
    node.activityHost.className = "agent-activity-feed";
    node.bubble.insertBefore(node.activityHost, node.body);
  }
  syncActivityFeed(node.activityHost, entries);
  node.lastActivity = entries.map((entry) => ({ ...entry }));
}

function syncCitations(
  node: MessageNode,
  msg: ChatMessage,
  onCitation?: (kind: "memory" | "change", id: string) => void,
): void {
  if (msg.role !== "assistant" || !msg.contextHits) {
    if (node.citations) {
      node.citations.remove();
      node.citations = null;
    }
    return;
  }

  const mem = msg.contextHits.memories ?? [];
  const ch = msg.contextHits.changes ?? [];
  if (mem.length === 0 && ch.length === 0) {
    if (node.citations) {
      node.citations.remove();
      node.citations = null;
    }
    return;
  }

  if (!node.citations) {
    node.citations = renderCitations(msg.contextHits, onCitation) as HTMLDivElement;
    node.bubble.appendChild(node.citations);
  }
}

function destroyMessageNode(node: MessageNode): void {
  node.mdMount?.destroy();
  node.bubble.remove();
}

function updateAssistantBody(
  node: MessageNode,
  msg: ChatMessage,
): void {
  const content = msg.content;

  if (msg.streaming) {
    if (!node.mdMount || !node.streaming) {
      node.mdMount?.destroy();
      node.mdMount = mountMarkdown(node.body, { mode: "stream" });
      node.lastContent = "";
      node.streaming = true;
    }

    if (content.length < node.lastContent.length) {
      node.mdMount.setContent(content);
      node.lastContent = content;
    } else if (content.length > node.lastContent.length) {
      const delta = content.slice(node.lastContent.length);
      node.mdMount.appendChunk?.(delta);
      node.lastContent = content;
    }

    if (!node.cursor) {
      node.cursor = document.createElement("span");
      node.cursor.className = "chat-stream-cursor";
      node.cursor.textContent = "▋";
      node.body.appendChild(node.cursor);
    }
    return;
  }

  if (node.streaming && node.mdMount) {
    node.mdMount.finishStream?.();
    node.streaming = false;
    if (content !== node.lastContent) {
      node.mdMount.setContent(content);
    }
    node.lastContent = content;
  } else if (!node.mdMount) {
    node.mdMount = mountMarkdown(node.body, { mode: "static" });
    node.mdMount.setContent(content);
    node.lastContent = content;
    node.streaming = false;
  } else if (content !== node.lastContent) {
    node.mdMount.setContent(content);
    node.lastContent = content;
  }

  if (node.cursor) {
    node.cursor.remove();
    node.cursor = null;
  }
}

export function mountChatTranscript(
  hostEl: HTMLElement,
  options?: {
    onCitation?: (kind: "memory" | "change", id: string) => void;
  },
): ChatTranscriptMount {
  const root = document.createElement("div");
  root.className = "chat-transcript";
  hostEl.appendChild(root);

  const nodes = new Map<string, MessageNode>();
  let emptyEl: HTMLDivElement | null = null;

  function render(): void {
    const messages = getChatMessages();

    if (messages.length === 0) {
      for (const node of nodes.values()) {
        destroyMessageNode(node);
      }
      nodes.clear();
      if (!emptyEl) {
        emptyEl = document.createElement("div");
        emptyEl.className = "chat-empty";
        emptyEl.textContent =
          "Ask about your project or request multi-file changes. ⌘I to focus.";
        root.appendChild(emptyEl);
      }
      return;
    }

    if (emptyEl) {
      emptyEl.remove();
      emptyEl = null;
    }

    const seen = new Set<string>();

    for (const msg of messages) {
      seen.add(msg.id);
      let node = nodes.get(msg.id);

      if (!node) {
        const bubble = document.createElement("div");
        bubble.className = `chat-message chat-message--${msg.role}`;
        bubble.dataset.msgId = msg.id;

        const body = document.createElement("div");
        body.className = "chat-message-body";
        bubble.appendChild(body);

        node = {
          bubble,
          body,
          activityHost: null,
          cursor: null,
          citations: null,
          mdMount: null,
          lastContent: "",
          lastActivity: null,
          streaming: false,
        };
        nodes.set(msg.id, node);
        root.appendChild(bubble);
      }

      bubbleClassSync(node, msg);

      if (msg.role === "assistant") {
        syncActivity(node, msg);
        const activityOnly =
          !msg.content.trim() && (msg.activity?.length ?? 0) > 0;
        node.body.hidden = activityOnly;
        node.bubble.classList.toggle("chat-message--activity-only", activityOnly);
        if (!activityOnly || msg.streaming) {
          updateAssistantBody(node, msg);
        } else {
          node.mdMount?.destroy();
          node.mdMount = null;
          node.body.innerHTML = "";
          node.body.classList.remove("md-body");
          if (node.cursor) {
            node.cursor.remove();
            node.cursor = null;
          }
        }
      } else {
        if (node.activityHost) {
          node.activityHost.remove();
          node.activityHost = null;
          node.lastActivity = null;
        }
        node.mdMount?.destroy();
        node.mdMount = null;
        node.lastContent = msg.content;
        node.streaming = false;
        node.body.classList.remove("md-body");
        node.body.textContent = msg.content;
        if (node.cursor) {
          node.cursor.remove();
          node.cursor = null;
        }
      }

      syncCitations(node, msg, options?.onCitation);
    }

    for (const [id, node] of nodes) {
      if (!seen.has(id)) {
        destroyMessageNode(node);
        nodes.delete(id);
      }
    }
  }

  const mount: ChatTranscriptMount = {
    scrollToBottom: () => {
      root.scrollTop = root.scrollHeight;
    },
  };

  render();

  subscribeChat(() => {
    render();
    mount.scrollToBottom();
  });

  return mount;
}

function bubbleClassSync(node: MessageNode, msg: ChatMessage): void {
  node.bubble.className = `chat-message chat-message--${msg.role}`;
  if (msg.streaming) {
    node.bubble.classList.add("chat-message--streaming");
  }
}
