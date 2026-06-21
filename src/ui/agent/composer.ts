import type { ComposerHost } from "./types";

export type ComposerMount = {
  getInput: () => string;
  setInput: (value: string) => void;
  focus: () => void;
  setRunning: (running: boolean) => void;
};

export function mountComposer(
  hostEl: HTMLElement,
  taskHost: ComposerHost,
): ComposerMount {
  const root = document.createElement("div");
  root.className = "agent-composer";

  const textarea = document.createElement("textarea");
  textarea.className = "textarea agent-composer-input";
  textarea.rows = 3;
  textarea.placeholder =
    "Edit: fix the bug in start.sh · Explain: analyze start.sh and describe what it does (⌘↵)";

  const actions = document.createElement("div");
  actions.className = "agent-composer-actions";

  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "btn btn-primary";
  runBtn.textContent = "▶ Run";

  const stopBtn = document.createElement("button");
  stopBtn.type = "button";
  stopBtn.className = "btn btn-secondary";
  stopBtn.textContent = "■ Stop";
  stopBtn.disabled = true;

  actions.append(runBtn, stopBtn);
  root.append(textarea, actions);
  hostEl.appendChild(root);

  runBtn.addEventListener("click", () => {
    const value = textarea.value.trim();
    if (value) {
      void taskHost.onRun(value);
    }
  });

  stopBtn.addEventListener("click", () => {
    void taskHost.onStop();
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
  };
}
