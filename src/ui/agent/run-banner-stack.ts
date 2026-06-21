import { cancelRun } from "../../agent/client";
import { getAgentMode } from "../../agent/mode";
import {
  getActiveRuns,
  getForegroundRunId,
  setForegroundRun,
  subscribeRunRegistry,
  type ActiveRun,
} from "../../agent/run-registry";
import { switchSession } from "../../chat/session-store";

export type RunBannerStackMount = {
  destroy: () => void;
};

function statusLabel(status: ActiveRun["status"]): string {
  switch (status) {
    case "hitl":
      return "Waiting for approval";
    case "suspended":
      return "Suspended";
    case "running":
      return "running";
    case "failed":
      return "failed";
    default:
      return status;
  }
}

export function mountRunBannerStack(
  hostEl: HTMLElement,
  options: {
    onStatus: (message: string) => void;
    onReview?: (run: ActiveRun) => void;
  },
): RunBannerStackMount {
  const root = document.createElement("div");
  root.className = "run-banner-stack";
  hostEl.appendChild(root);

  function render(): void {
    if (getAgentMode() !== "multitask") {
      root.replaceChildren();
      root.hidden = true;
      return;
    }
    const runs = getActiveRuns().filter(
      (r) =>
        r.status === "running" ||
        r.status === "hitl" ||
        r.status === "suspended",
    );
    const visible = runs
      .filter((r) => r.runId !== getForegroundRunId())
      .slice(0, 2);
    root.hidden = visible.length === 0;
    root.replaceChildren();

    for (const run of visible) {
      const banner = document.createElement("div");
      banner.className = "agent-sidecar-banner run-banner";

      const text = document.createElement("span");
      text.textContent = `Run ${run.runId.slice(0, 8)} — ${statusLabel(run.status)} — ${run.title}`;

      const actions = document.createElement("span");
      actions.className = "run-banner-actions";

      const takeOver = document.createElement("button");
      takeOver.type = "button";
      takeOver.className = "btn btn-ghost btn-sm";
      takeOver.textContent = "Take over";
      takeOver.addEventListener("click", () => {
        void switchSession(run.sessionId).then((ok) => {
          if (ok) {
            setForegroundRun(run.runId);
            options.onStatus(`Switched to ${run.title}`);
          }
        });
      });

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn btn-ghost btn-sm";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        void cancelRun(run.runId).then(() => {
          options.onStatus(`Cancelled run ${run.runId.slice(0, 8)}`);
        });
      });

      actions.append(takeOver);
      if (run.status === "hitl" && options.onReview) {
        const review = document.createElement("button");
        review.type = "button";
        review.className = "btn btn-ghost btn-sm";
        review.textContent = "Review";
        review.addEventListener("click", () => {
          void switchSession(run.sessionId).then((ok) => {
            if (ok) {
              setForegroundRun(run.runId);
              options.onReview?.(run);
            }
          });
        });
        actions.append(review);
      }
      actions.append(cancel);

      banner.append(text, actions);
      root.appendChild(banner);
    }
  }

  const unsub = subscribeRunRegistry(render);
  render();

  return {
    destroy() {
      unsub();
      root.remove();
    },
  };
}
