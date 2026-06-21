import type { AgentStep } from "../../agent/types";
import { formatStepDuration, humanizeStepLabel, stepIcon } from "./step-labels";
import { renderAiText } from "../../chat/markdown";

export function mountTimeline(
  hostEl: HTMLElement,
  options?: { defaultCollapsed?: boolean },
): {
  section: HTMLDivElement;
  render: (steps: AgentStep[]) => void;
} {
  const section = document.createElement("div");
  section.className = "agent-section agent-timeline-section";

  let collapsed = options?.defaultCollapsed ?? false;

  const header = document.createElement("button");
  header.type = "button";
  header.className = "agent-section-header agent-timeline-toggle";

  const label = document.createElement("p");
  label.className = "label-caps";
  label.textContent = "Current run";

  const elapsed = document.createElement("span");
  elapsed.className = "agent-run-elapsed";
  elapsed.textContent = "";

  const chevron = document.createElement("span");
  chevron.className = "agent-timeline-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = collapsed ? "▸" : "▾";

  header.append(label, elapsed, chevron);

  const list = document.createElement("div");
  list.className = "agent-timeline";
  list.setAttribute("aria-live", "polite");
  list.hidden = collapsed;

  section.append(header, list);
  hostEl.appendChild(section);

  function syncCollapsed(): void {
    list.hidden = collapsed;
    chevron.textContent = collapsed ? "▸" : "▾";
    section.classList.toggle("agent-timeline-section--collapsed", collapsed);
  }

  header.addEventListener("click", () => {
    collapsed = !collapsed;
    syncCollapsed();
  });

  syncCollapsed();

  return {
    section,
    render(steps: AgentStep[]) {
      list.innerHTML = "";
      if (steps.length === 0) {
        section.hidden = true;
        return;
      }
      section.hidden = false;

      const firstStart = steps.find((s) => s.startedAt)?.startedAt;
      if (firstStart) {
        const sec = Math.floor((Date.now() - firstStart) / 1000);
        elapsed.textContent = sec > 0 ? `~${sec}s` : "";
      } else {
        elapsed.textContent = "";
      }

      for (const step of steps) {
        const row = document.createElement("div");
        row.className = `agent-timeline-item agent-timeline-item--${step.status}`;

        const icon = document.createElement("span");
        icon.className = `agent-timeline-icon agent-timeline-icon--${step.status}`;
        icon.textContent = stepIcon(step.status);
        icon.setAttribute("aria-hidden", "true");

        const body = document.createElement("div");
        body.className = "agent-timeline-body";

        const title = document.createElement("div");
        title.className = "agent-timeline-label";
        title.textContent = humanizeStepLabel(step.label);

        body.appendChild(title);

        const duration = formatStepDuration(step);
        if (duration) {
          const meta = document.createElement("div");
          meta.className = "agent-timeline-meta";
          meta.textContent = duration;
          body.appendChild(meta);
        }

        if (step.detail) {
          const detail = document.createElement("div");
          detail.className = "agent-timeline-detail md-body md-body--compact";
          renderAiText(detail, step.detail, { compact: true });
          body.appendChild(detail);
        }

        row.append(icon, body);
        list.appendChild(row);
      }
    },
  };
}
