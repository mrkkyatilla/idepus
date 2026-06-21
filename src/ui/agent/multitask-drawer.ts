import { cancelRun } from "../../agent/client";
import { getAgentMode, subscribeAgentMode } from "../../agent/mode";
import {
  getActiveRuns,
  getForegroundRunId,
  setForegroundRun,
  subscribeRunRegistry,
  type ActiveRun,
} from "../../agent/run-registry";
import { switchSession } from "../../chat/session-store";

export type MultitaskDrawerMount = {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  destroy: () => void;
};

export function mountMultitaskDrawer(
  hostEl: HTMLElement,
  options: { onStatus: (message: string) => void },
): MultitaskDrawerMount {
  const overlay = document.createElement("div");
  overlay.className = "multitask-drawer-overlay";
  overlay.hidden = true;

  const panel = document.createElement("div");
  panel.className = "multitask-drawer";

  const header = document.createElement("div");
  header.className = "multitask-drawer-header";
  const title = document.createElement("span");
  title.textContent = "Active runs";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-ghost btn-icon";
  closeBtn.textContent = "×";
  header.append(title, closeBtn);

  const list = document.createElement("div");
  list.className = "multitask-drawer-list";

  panel.append(header, list);
  overlay.appendChild(panel);
  hostEl.appendChild(overlay);

  let open = false;

  function renderList(): void {
    list.replaceChildren();
    const runs = getActiveRuns().filter(
      (r) =>
        r.status === "running" ||
        r.status === "hitl" ||
        r.status === "suspended",
    );
    if (runs.length === 0) {
      const empty = document.createElement("p");
      empty.className = "modal-hint";
      empty.textContent = "No background runs.";
      list.appendChild(empty);
      return;
    }

    for (const run of runs) {
      const row = document.createElement("div");
      row.className = "multitask-drawer-row";
      if (run.runId === getForegroundRunId()) {
        row.classList.add("multitask-drawer-row--foreground");
      }

      const meta = document.createElement("div");
      meta.className = "multitask-drawer-meta";
      meta.textContent = `${run.runId.slice(0, 8)} · ${run.status} · ${run.title}`;

      const actions = document.createElement("div");
      actions.className = "multitask-drawer-actions";

      const focusBtn = document.createElement("button");
      focusBtn.type = "button";
      focusBtn.className = "btn btn-ghost btn-sm";
      focusBtn.textContent = "Focus";
      focusBtn.addEventListener("click", () => {
        void switchSession(run.sessionId).then((ok) => {
          if (ok) {
            setForegroundRun(run.runId);
            options.onStatus(`Focused run ${run.runId.slice(0, 8)}`);
            closeDrawer();
          }
        });
      });

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-ghost btn-sm";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        void cancelRun(run.runId);
      });

      actions.append(focusBtn, cancelBtn);
      row.append(meta, actions);
      list.appendChild(row);
    }
  }

  function openDrawer(): void {
    if (getAgentMode() !== "multitask") {
      return;
    }
    open = true;
    overlay.hidden = false;
    renderList();
  }

  function closeDrawer(): void {
    open = false;
    overlay.hidden = true;
  }

  closeBtn.addEventListener("click", closeDrawer);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeDrawer();
    }
  });

  const unsubRegistry = subscribeRunRegistry(renderList);
  const unsubMode = subscribeAgentMode(() => {
    if (getAgentMode() !== "multitask") {
      closeDrawer();
    }
    renderList();
  });

  return {
    open: openDrawer,
    close: closeDrawer,
    isOpen: () => open,
    destroy() {
      unsubRegistry();
      unsubMode();
      overlay.remove();
    },
  };
}
