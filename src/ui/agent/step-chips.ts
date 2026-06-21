import type { AgentStep } from "../../agent/types";
import { humanizeStepLabel, stepChipType, stepIcon } from "./step-labels";

export function mountStepChips(hostEl: HTMLElement): {
  render: (steps: AgentStep[]) => void;
} {
  const row = document.createElement("div");
  row.className = "step-chips-row agent-activity-feed agent-activity-feed--inline";
  row.setAttribute("aria-live", "polite");
  hostEl.appendChild(row);

  return {
    render(steps: AgentStep[]) {
      row.innerHTML = "";
      const recent = steps
        .filter(
          (step) =>
            step.status === "running" ||
            step.status === "done" ||
            step.status === "error",
        )
        .filter(
          (step) =>
            !step.label.toLowerCase().startsWith("run ") &&
            step.label !== "approval_required",
        )
        .slice(-4);

      if (recent.length === 0) {
        row.hidden = true;
        return;
      }
      row.hidden = false;

      for (const step of recent) {
        const chip = document.createElement("div");
        const type = stepChipType(step.label);
        chip.className = `agent-activity-item agent-activity-item--compact agent-activity-item--${step.status} step-chip step-chip--${type}`;

        const icon = document.createElement("span");
        icon.className = "agent-activity-item__icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = stepIcon(step.status);

        const label = document.createElement("span");
        label.className = "agent-activity-item__label";
        label.textContent = humanizeStepLabel(step.label);

        chip.append(icon, label);
        row.appendChild(chip);
      }
    },
  };
}
