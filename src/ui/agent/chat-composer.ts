import {
  attachMentionAutocomplete,
  addMention,
  IDEPUS_PATH_MIME,
  parseIdepusPathDrag,
  relWorkspacePath,
} from "../../context/mention-autocomplete";
import type { AgentMode } from "../../agent/mode";
import type { ComposerHost } from "./types";

export type ChatComposerMount = {
  getInput: () => string;
  setInput: (value: string) => void;
  focus: () => void;
  setRunning: (running: boolean) => void;
  setMode: (mode: AgentMode) => void;
};

const PLACEHOLDERS: Record<AgentMode, string> = {
  agent: "Refactor across files… (⌘↵ send, @path or drag files here)",
  ask: "Ask about the codebase (read-only)…",
  plan: "What to plan? Plan is saved to <code>.idepus/plans/</code> and opened here. (⌘↵ send)…",
  multitask: "Start a task — parallel runs supported (⌘↵ send)…",
};

export function mountChatComposer(
  hostEl: HTMLElement,
  taskHost: ComposerHost & {
    getWorkspaceRoot?: () => string | undefined;
    getWorkspaceId?: () => string | undefined;
    initialDraft?: string;
    onDraftChange?: (value: string) => void;
  },
): ChatComposerMount {
  const root = document.createElement("div");
  root.className = "agent-composer chat-composer";

  const chips = document.createElement("div");
  chips.className = "mention-chips";

  const textarea = document.createElement("textarea");
  textarea.className = "textarea agent-composer-input chat-composer-input";
  textarea.rows = 3;
  textarea.placeholder = PLACEHOLDERS.agent;
  if (taskHost.initialDraft) {
    textarea.value = taskHost.initialDraft;
  }

  const actions = document.createElement("div");
  actions.className = "agent-composer-actions";

  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "btn btn-primary";
  runBtn.textContent = "Send";

  const stopBtn = document.createElement("button");
  stopBtn.type = "button";
  stopBtn.className = "btn btn-secondary";
  stopBtn.textContent = "■ Stop";
  stopBtn.disabled = true;

  actions.append(runBtn, stopBtn);
  root.append(chips, textarea, actions);
  hostEl.appendChild(root);

  attachMentionAutocomplete(
    textarea,
    chips,
    taskHost.getWorkspaceRoot?.(),
    () => {},
    taskHost.getWorkspaceId?.(),
  );

  function handleDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes(IDEPUS_PATH_MIME)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    root.classList.add("chat-composer--drop-target");
  }

  function handleDragLeave(event: DragEvent): void {
    if (event.currentTarget === root && !root.contains(event.relatedTarget as Node)) {
      root.classList.remove("chat-composer--drop-target");
    }
  }

  function handleDrop(event: DragEvent): void {
    root.classList.remove("chat-composer--drop-target");
    const payload = event.dataTransfer
      ? parseIdepusPathDrag(event.dataTransfer)
      : null;
    if (!payload) {
      return;
    }
    event.preventDefault();
    const workspaceRoot = taskHost.getWorkspaceRoot?.();
    const rel =
      payload.relPath ||
      relWorkspacePath(payload.absPath, workspaceRoot) ||
      payload.absPath;
    if (workspaceRoot && relWorkspacePath(payload.absPath, workspaceRoot) === null) {
      taskHost.onStatus?.("Dropped path is outside the workspace");
      return;
    }
    const kind = payload.kind === "folder" ? "folder" : "file";
    const label =
      kind === "folder"
        ? `@${payload.name}/`
        : `@${payload.name}`;
    addMention({ kind, path: rel, label });
    textarea.focus();
  }

  root.addEventListener("dragover", handleDragOver);
  root.addEventListener("dragleave", handleDragLeave);
  root.addEventListener("drop", handleDrop);

  runBtn.addEventListener("click", () => {
    const value = textarea.value.trim();
    if (value) {
      void taskHost.onRun(value);
    }
  });

  stopBtn.addEventListener("click", () => {
    void taskHost.onStop();
  });

  textarea.addEventListener("input", () => {
    taskHost.onDraftChange?.(textarea.value);
  });

  textarea.addEventListener("keydown", (event) => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (mod && event.key === "Enter") {
      event.preventDefault();
      const value = textarea.value.trim();
      if (value && !runBtn.disabled) {
        void taskHost.onRun(value);
      }
    }
  });

  return {
    getInput: () => textarea.value,
    setInput: (value) => {
      textarea.value = value;
    },
    focus: () => textarea.focus(),
    setRunning: (running) => {
      runBtn.disabled = running;
      stopBtn.disabled = !running;
    },
    setMode: (mode) => {
      textarea.placeholder = PLACEHOLDERS[mode];
    },
  };
}
