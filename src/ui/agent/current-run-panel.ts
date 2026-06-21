import type { AgentStep } from "../../agent/types";
import { getAgentMode, subscribeAgentMode } from "../../agent/mode";
import { getCurrentRun } from "../../agent/task-tracker";
import { mountPlanRunStatus } from "./plan-run-status";
import { mountStepChips } from "./step-chips";
import { mountTimeline } from "./timeline";

const OPEN_KEY = "idepus.agentRunPanelOpen";
const HEIGHT_KEY = "idepus.agentRunPanelHeight";
const COLLAPSED_KEY = "idepus.agentRunPanelCollapsed";
const DEFAULT_HEIGHT = 180;
const MIN_HEIGHT = 100;
const MAX_HEIGHT_RATIO = 0.45;

function loadOpen(): boolean {
  const raw = localStorage.getItem(OPEN_KEY);
  if (raw === null) {
    return true;
  }
  return raw === "1";
}

function loadHeight(): number {
  const raw = localStorage.getItem(HEIGHT_KEY);
  const n = raw ? Number(raw) : DEFAULT_HEIGHT;
  if (!Number.isFinite(n)) {
    return DEFAULT_HEIGHT;
  }
  return n;
}

function loadCollapsed(): boolean {
  return localStorage.getItem(COLLAPSED_KEY) === "1";
}

export type CurrentRunPanel = {
  render: (steps: AgentStep[]) => void;
  destroy: () => void;
};

export function mountCurrentRunPanel(
  panelEl: HTMLElement,
  insertBefore: HTMLElement,
): CurrentRunPanel {
  const resizer = document.createElement("div");
  resizer.className = "agent-run-resizer";
  resizer.title = "Drag to resize";
  resizer.hidden = true;

  const runPanel = document.createElement("div");
  runPanel.className = "agent-run-panel";
  runPanel.hidden = true;

  const header = document.createElement("button");
  header.type = "button";
  header.className = "agent-run-panel-header";

  const title = document.createElement("span");
  title.className = "agent-run-panel-title";
  title.textContent = "Current run";

  const chevron = document.createElement("span");
  chevron.className = "agent-run-panel-chevron";
  chevron.setAttribute("aria-hidden", "true");

  header.append(title, chevron);

  const body = document.createElement("div");
  body.className = "agent-run-panel-body";

  const chipsHost = document.createElement("div");
  chipsHost.className = "step-chips-host";
  body.appendChild(chipsHost);
  const stepChips = mountStepChips(chipsHost);

  const planStatusHost = document.createElement("div");
  planStatusHost.className = "plan-run-status-host";
  body.appendChild(planStatusHost);
  const planRunStatus = mountPlanRunStatus(planStatusHost);

  const timeline = mountTimeline(body, { defaultCollapsed: false });
  const timelineSection = timeline.section;
  timelineSection.classList.add("agent-run-timeline");

  runPanel.append(header, body);
  panelEl.insertBefore(runPanel, insertBefore);
  panelEl.insertBefore(resizer, runPanel);

  let open = loadOpen();
  let height = loadHeight();
  let collapsed = loadCollapsed();
  let hasRunContent = false;

  function maxHeight(): number {
    return Math.floor(panelEl.clientHeight * MAX_HEIGHT_RATIO);
  }

  function syncCollapsedUi(): void {
    body.hidden = collapsed;
    chevron.textContent = collapsed ? "▸" : "▾";
    runPanel.classList.toggle("agent-run-panel--collapsed", collapsed);
    resizer.hidden = !open || collapsed || !hasRunContent;
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }

  function applyHeight(next: number): void {
    height = Math.min(maxHeight(), Math.max(MIN_HEIGHT, next));
    runPanel.style.height = collapsed ? "" : `${height}px`;
    localStorage.setItem(HEIGHT_KEY, String(height));
  }

  function applyOpen(next: boolean): void {
    open = next;
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    if (!hasRunContent) {
      runPanel.hidden = true;
      resizer.hidden = true;
      return;
    }
    runPanel.hidden = !open;
    syncCollapsedUi();
    if (open && !collapsed) {
      applyHeight(height);
    }
  }

  function setVisible(hasContent: boolean): void {
    hasRunContent = hasContent;
    if (!hasContent) {
      runPanel.hidden = true;
      resizer.hidden = true;
      return;
    }
    if (!open) {
      open = true;
      localStorage.setItem(OPEN_KEY, "1");
    }
    applyOpen(true);
  }

  function applyPlanStatusVisibility(): void {
    planStatusHost.hidden = getAgentMode() !== "plan";
  }

  header.addEventListener("click", () => {
    if (!hasRunContent) {
      return;
    }
    collapsed = !collapsed;
    syncCollapsedUi();
    if (!collapsed && open) {
      applyHeight(height);
    }
  });

  let dragging = false;

  resizer.addEventListener("mousedown", (event) => {
    event.preventDefault();
    dragging = true;
    document.body.classList.add("agent-run-resizing");
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }
    const composer = insertBefore.getBoundingClientRect();
    const next = composer.top - event.clientY;
    applyHeight(next);
    if (collapsed) {
      collapsed = false;
      syncCollapsedUi();
    }
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.classList.remove("agent-run-resizing");
  });

  const unsubscribeMode = subscribeAgentMode(() => {
    applyPlanStatusVisibility();
  });

  applyPlanStatusVisibility();
  syncCollapsedUi();

  return {
    render(steps: AgentStep[]) {
      const running = Boolean(getCurrentRun());
      const hasSteps = steps.length > 0;
      setVisible(running || hasSteps);
      stepChips.render(steps);
      if (getAgentMode() === "plan") {
        planRunStatus.render(steps);
      }
      timeline.render(steps);
    },
    destroy() {
      unsubscribeMode();
      resizer.remove();
      runPanel.remove();
    },
  };
}
