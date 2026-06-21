import type { AgentStep } from "../../agent/types";
import { getCurrentRun, getLastRunError } from "../../agent/task-tracker";
import { renderAiText } from "../../chat/markdown";
import { agentStepsToActivity, syncActivityFeed } from "./activity-feed";

export function mountPlanRunStatus(hostEl: HTMLElement): {
  render: (steps: AgentStep[]) => void;
} {
  const bar = document.createElement("div");
  bar.className = "plan-run-status";
  bar.hidden = true;
  hostEl.appendChild(bar);

  const feed = document.createElement("div");
  feed.className = "agent-activity-feed agent-activity-feed--plan-status";
  bar.appendChild(feed);

  return {
    render(steps: AgentStep[]) {
      const current = getCurrentRun();
      const lastError = getLastRunError();

      if (lastError && !current) {
        bar.hidden = false;
        bar.className = "plan-run-status plan-run-status--error";
        feed.replaceChildren();
        const errorBox = document.createElement("div");
        errorBox.className = "plan-run-status-error md-body md-body--compact";
        renderAiText(errorBox, lastError, { compact: true });
        bar.replaceChildren(errorBox);
        return;
      }

      if (!current) {
        bar.hidden = true;
        bar.replaceChildren();
        bar.className = "plan-run-status";
        bar.appendChild(feed);
        feed.replaceChildren();
        return;
      }

      const entries = agentStepsToActivity(steps);
      if (entries.length === 0) {
        entries.push({
          id: "plan-run-placeholder",
          label: "Exploring codebase and drafting plan",
          status: "running",
        });
      }

      bar.hidden = false;
      bar.className = "plan-run-status plan-run-status--active";
      if (!bar.contains(feed)) {
        bar.replaceChildren(feed);
      }
      syncActivityFeed(feed, entries);
    },
  };
}
