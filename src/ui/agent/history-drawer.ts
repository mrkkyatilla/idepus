import {
  deleteRunArchive,
  listRunArchives,
  loadRunArchive,
} from "../../chat/persist";
import type { RunArchive, RunArchiveMeta } from "../../chat/session-types";
import {
  getWorkspaceId,
  openSessionFromHistory,
} from "../../chat/session-store";
import { humanizeStepLabel, stepIcon } from "./step-labels";
import { renderAiText } from "../../chat/markdown";

export type HistoryDrawerMount = {
  destroy: () => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  openRunDetail: (runId: string) => Promise<void>;
};

export function mountHistoryDrawer(
  hostEl: HTMLElement,
  options: {
    onStatus: (message: string) => void;
    onViewChanges?: (runId: string) => void;
    onReturnToChat?: () => void;
  },
): HistoryDrawerMount {
  const backdrop = document.createElement("div");
  backdrop.className = "history-drawer-backdrop";
  backdrop.hidden = true;

  const drawer = document.createElement("div");
  drawer.className = "history-drawer";
  drawer.hidden = true;

  const header = document.createElement("div");
  header.className = "history-drawer-header";

  const title = document.createElement("h3");
  title.className = "history-drawer-title";
  title.textContent = "Run history";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-ghost btn-icon";
  closeBtn.title = "Close (Esc)";
  closeBtn.textContent = "×";

  header.append(title, closeBtn);

  const filters = document.createElement("div");
  filters.className = "history-drawer-filters";

  const daysSelect = document.createElement("select");
  daysSelect.className = "history-filter-days";
  for (const [val, label] of [
    ["7", "Last 7 days"],
    ["30", "Last 30 days"],
    ["90", "Last 90 days"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    daysSelect.appendChild(opt);
  }
  daysSelect.value = "30";
  filters.appendChild(daysSelect);

  const list = document.createElement("div");
  list.className = "history-drawer-list";

  const detail = document.createElement("div");
  detail.className = "history-drawer-detail";
  detail.hidden = true;

  drawer.append(header, filters, list, detail);
  hostEl.appendChild(backdrop);
  hostEl.appendChild(drawer);

  let open = false;
  let metas: RunArchiveMeta[] = [];

  function setOpen(next: boolean): void {
    open = next;
    drawer.hidden = !open;
    backdrop.hidden = !open;
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
    backdrop.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      void refreshList();
    } else {
      detail.hidden = true;
    }
  }

  async function refreshList(): Promise<void> {
    const wsId = getWorkspaceId();
    metas = await listRunArchives({
      workspaceId: wsId ?? undefined,
      limit: 50,
      days: Number(daysSelect.value),
    });
    renderList();
  }

  function renderList(): void {
    list.innerHTML = "";
    if (metas.length === 0) {
      const empty = document.createElement("p");
      empty.className = "history-drawer-empty";
      empty.textContent = "No archived runs yet.";
      list.appendChild(empty);
      return;
    }

    for (const meta of metas) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "history-drawer-row";

      const prompt = document.createElement("div");
      prompt.className = "history-drawer-prompt";
      prompt.textContent = meta.inputSummary;

      const metaLine = document.createElement("div");
      metaLine.className = "history-drawer-meta";
      const date = new Date(meta.endedAt ?? meta.startedAt).toLocaleString();
      metaLine.textContent = `${date} · ${meta.agentId} · ${meta.status}`;

      row.append(prompt, metaLine);
      row.addEventListener("click", () => {
        void showDetail(meta.runId);
      });
      list.appendChild(row);
    }
  }

  async function showDetail(runId: string): Promise<void> {
    const archive = await loadRunArchive(runId);
    if (!archive) {
      options.onStatus("Run archive not found");
      return;
    }
    detail.hidden = false;
    detail.innerHTML = "";
    detail.appendChild(buildDetail(archive));
  }

  function buildDetail(archive: RunArchive): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "history-detail";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn-ghost btn-sm";
    back.textContent = "← Back";
    back.addEventListener("click", () => {
      detail.hidden = true;
    });

    const heading = document.createElement("p");
    heading.className = "history-detail-input";
    heading.textContent = archive.inputSummary;

    const actions = document.createElement("div");
    actions.className = "history-detail-actions";

    const openChat = document.createElement("button");
    openChat.type = "button";
    openChat.className = "btn btn-secondary btn-sm";
    openChat.textContent = "Open in chat";
    openChat.addEventListener("click", () => {
      void (async () => {
        const ok = await openSessionFromHistory(archive.sessionId);
        if (!ok) {
          options.onStatus("Could not open chat for this run");
          return;
        }
        setOpen(false);
        options.onReturnToChat?.();
        options.onStatus("Opened chat for this run");
      })();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-ghost btn-sm";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      if (!confirm("Delete this run from local history?")) {
        return;
      }
      void deleteRunArchive(archive.runId).then(() => {
        detail.hidden = true;
        void refreshList();
        options.onStatus("Run deleted");
      });
    });

    const replay = document.createElement("button");
    replay.type = "button";
    replay.className = "btn btn-ghost btn-sm";
    replay.disabled = true;
    replay.title = "Replay — coming with G07";
    replay.textContent = "Replay";

    actions.append(openChat, del, replay);

    const stepsEl = document.createElement("div");
    stepsEl.className = "history-detail-steps";
    for (const step of archive.steps) {
      const row = document.createElement("div");
      row.className = `agent-timeline-item agent-timeline-item--${step.status}`;
      const icon = document.createElement("span");
      icon.className = "agent-timeline-icon";
      icon.textContent = stepIcon(step.status);
      const label = document.createElement("span");
      label.textContent = humanizeStepLabel(step.label);
      row.append(icon, label);
      stepsEl.appendChild(row);
    }

    if (archive.filesTouched.length > 0) {
      const files = document.createElement("p");
      files.className = "history-detail-files";
      files.textContent = `Files: ${archive.filesTouched.join(", ")}`;
      wrap.append(files);
    }

    const viewChanges = document.createElement("button");
    viewChanges.type = "button";
    viewChanges.className = "btn btn-ghost btn-sm";
    viewChanges.textContent = "View changes";
    viewChanges.addEventListener("click", () => {
      options.onViewChanges?.(archive.runId);
      setOpen(false);
    });
    actions.append(viewChanges);

    if (archive.outputPreview) {
      const out = document.createElement("div");
      out.className = "history-detail-output md-body md-body--compact";
      renderAiText(out, archive.outputPreview, { compact: true });
      wrap.append(out);
    }

    wrap.prepend(heading, actions, stepsEl, back);
    return wrap;
  }

  closeBtn.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  daysSelect.addEventListener("change", () => {
    void refreshList();
  });

  return {
    destroy() {
      backdrop.remove();
      drawer.remove();
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    isOpen: () => open,
    openRunDetail: showDetail,
  };
}
