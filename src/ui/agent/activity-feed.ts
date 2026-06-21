import type { ActivityEntry } from "../../chat/types";
import type { AgentStep } from "../../agent/types";
import { humanizeStepLabel, stepIcon } from "./step-labels";

export function createActivityItem(entry: ActivityEntry): HTMLElement {
  const el = document.createElement("div");
  el.className = `agent-activity-item agent-activity-item--${entry.status}`;
  el.dataset.activityId = entry.id;

  const icon = document.createElement("span");
  icon.className = "agent-activity-item__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = stepIcon(entry.status);

  const label = document.createElement("span");
  label.className = "agent-activity-item__label";
  label.textContent = entry.label;

  el.append(icon, label);
  return el;
}

export function syncActivityFeed(
  host: HTMLElement,
  entries: ActivityEntry[],
): void {
  host.replaceChildren();
  for (const entry of entries) {
    host.appendChild(createActivityItem(entry));
  }
}

export function agentStepsToActivity(steps: AgentStep[]): ActivityEntry[] {
  return steps
    .filter(
      (step) =>
        step.status !== "pending" &&
        !step.label.toLowerCase().startsWith("run ") &&
        step.label !== "approval_required",
    )
    .slice(-6)
    .map((step) => ({
      id: step.id,
      label: humanizeStepLabel(step.label),
      status:
        step.status === "done"
          ? "done"
          : step.status === "error"
            ? "error"
            : "running",
    }));
}
