import { getAgentMode, subscribeAgentMode } from "../../agent/mode";
import { mountPlanEditor } from "./plan-split";
import type { TaskTrackerHost } from "../task-tracker";

const WIDTH_KEY = "idepus.planPanelWidth";
const OPEN_KEY = "idepus.planPanelOpen";
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;

function loadWidth(): number {
  const raw = localStorage.getItem(WIDTH_KEY);
  const n = raw ? Number(raw) : DEFAULT_WIDTH;
  if (!Number.isFinite(n)) {
    return DEFAULT_WIDTH;
  }
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
}

function loadOpen(): boolean {
  const raw = localStorage.getItem(OPEN_KEY);
  if (raw === null) {
    return true;
  }
  return raw === "1";
}

export type PlanPanel = {
  destroy: () => void;
};

export function createPlanPanel(
  panelEl: HTMLElement,
  resizerEl: HTMLElement,
  taskHost: TaskTrackerHost,
): PlanPanel {
  panelEl.className = "plan-panel";
  panelEl.innerHTML = "";

  const inner = document.createElement("div");
  inner.className = "plan-panel-inner";

  const header = document.createElement("div");
  header.className = "plan-panel-header";

  const title = document.createElement("span");
  title.className = "plan-panel-title";
  title.textContent = "Plan";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-ghost btn-icon plan-panel-close";
  closeBtn.title = "Hide plan panel";
  closeBtn.textContent = "×";

  header.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "plan-panel-body";

  inner.append(header, body);
  panelEl.appendChild(inner);

  let width = loadWidth();
  let userOpen = loadOpen();
  let dragging = false;

  const teardownPlanEditor = mountPlanEditor(body, {
    getRunLauncherOptions: () => ({
      workspaceRoot: taskHost.getWorkspaceRoot(),
      workspaceId: taskHost.getWorkspaceId(),
      getEditorView: () => taskHost.getEditorView(),
      getActiveFilePath: taskHost.getActiveFilePath,
      openFile: taskHost.openFile,
      onStatus: taskHost.onStatus,
    }),
    onStatus: (message) => taskHost.onStatus(message),
    showAgentPanel: taskHost.showAgentPanel,
  });

  function applyWidth(next: number): void {
    width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
    panelEl.style.width = `${width}px`;
    localStorage.setItem(WIDTH_KEY, String(width));
  }

  function applyVisibility(): void {
    const planMode = getAgentMode() === "plan";
    const visible = planMode && userOpen;
    panelEl.hidden = !visible;
    resizerEl.hidden = !visible;
    if (visible) {
      applyWidth(width);
    }
  }

  closeBtn.addEventListener("click", () => {
    userOpen = false;
    localStorage.setItem(OPEN_KEY, "0");
    applyVisibility();
  });

  resizerEl.addEventListener("mousedown", (event) => {
    event.preventDefault();
    dragging = true;
    document.body.classList.add("plan-panel-resizing");
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }
    const rect = panelEl.getBoundingClientRect();
    const next = rect.right - event.clientX;
    applyWidth(next);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.classList.remove("plan-panel-resizing");
  });

  const unsubscribeMode = subscribeAgentMode(() => {
    if (getAgentMode() === "plan" && !userOpen) {
      userOpen = true;
      localStorage.setItem(OPEN_KEY, "1");
    }
    applyVisibility();
  });

  applyWidth(width);
  applyVisibility();

  return {
    destroy() {
      unsubscribeMode();
      teardownPlanEditor();
      panelEl.innerHTML = "";
    },
  };
}
