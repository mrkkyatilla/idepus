import { listChangesByRun, listRecentChanges, searchChanges } from "../../memory/persist";
import type { ChangeRecord } from "../../memory/types";
import { subscribeMemoryStore } from "../../memory/store";
import { renderAiText } from "../../chat/markdown";

export type ChangesHubMount = {
  open: (filter?: { runId?: string; query?: string }) => void;
  close: () => void;
  isOpen: () => boolean;
  destroy: () => void;
};

function formatAcceptedAt(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }
  return new Date(ts).toLocaleDateString();
}

export function mountChangesHub(
  hostEl: HTMLElement,
  options: {
    workspaceId: () => string | undefined;
    onStatus: (message: string) => void;
    onOpenFile: (path: string) => Promise<void>;
    onViewRun?: (runId: string) => void;
  },
): ChangesHubMount {
  const hub = document.createElement("div");
  hub.className = "agent-chat-hub changes-hub";
  hub.hidden = true;

  const header = document.createElement("div");
  header.className = "agent-chat-hub-header";

  const title = document.createElement("h3");
  title.className = "agent-chat-hub-title";
  title.textContent = "Changes";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "btn btn-ghost btn-sm";
  backBtn.textContent = "Back to chat";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-ghost btn-icon agent-chat-hub-close";
  closeBtn.title = "Close";
  closeBtn.textContent = "×";

  header.append(title, backBtn, closeBtn);

  const searchRow = document.createElement("div");
  searchRow.className = "changes-hub-search";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "input";
  searchInput.placeholder = "Search accepted changes…";
  searchRow.appendChild(searchInput);

  const list = document.createElement("div");
  list.className = "agent-chat-hub-list";
  hub.append(header, searchRow, list);
  hostEl.appendChild(hub);

  let open = false;
  let records: ChangeRecord[] = [];
  let runFilter: string | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  function render(): void {
    list.innerHTML = "";
    if (records.length === 0) {
      const empty = document.createElement("p");
      empty.className = "agent-chat-hub-empty";
      empty.textContent = runFilter
        ? "No accepted changes for this run."
        : "No accepted changes yet. Apply agent patches to build change memory.";
      list.appendChild(empty);
      return;
    }

    for (const record of records) {
      const row = document.createElement("div");
      row.className = "agent-chat-hub-row changes-hub-row";

      const main = document.createElement("div");
      main.className = "agent-chat-hub-row-main";

      const rowTitle = document.createElement("span");
      rowTitle.className = "agent-chat-hub-row-title";
      rowTitle.textContent = record.path;

      const summary = document.createElement("div");
      summary.className = "agent-chat-hub-row-meta changes-hub-summary md-body md-body--compact";
      renderAiText(summary, record.summary, { compact: true });

      const meta = document.createElement("span");
      meta.className = "agent-chat-hub-row-meta";
      meta.textContent = formatAcceptedAt(record.acceptedAt);

      main.append(rowTitle, summary, meta);

      const actions = document.createElement("div");
      actions.className = "changes-hub-actions";

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "btn btn-ghost btn-sm";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        void options.onOpenFile(record.path);
      });

      const runBtn = document.createElement("button");
      runBtn.type = "button";
      runBtn.className = "btn btn-ghost btn-sm";
      runBtn.textContent = "Run";
      runBtn.title = record.runId;
      runBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        options.onViewRun?.(record.runId);
      });

      actions.append(openBtn, runBtn);

      const excerpt = document.createElement("pre");
      excerpt.className = "changes-hub-excerpt md-diff-excerpt";
      excerpt.hidden = true;
      excerpt.textContent = record.diffExcerpt;

      row.append(main, actions);
      row.addEventListener("click", () => {
        excerpt.hidden = !excerpt.hidden;
        if (!excerpt.parentElement) {
          row.appendChild(excerpt);
        }
      });

      list.appendChild(row);
    }
  }

  async function load(query?: string): Promise<void> {
    const wsId = options.workspaceId();
    if (!wsId) {
      records = [];
      render();
      return;
    }
    try {
      if (runFilter) {
        records = await listChangesByRun(wsId, runFilter);
      } else if (query?.trim()) {
        records = await searchChanges(wsId, query.trim(), 50);
      } else {
        records = await listRecentChanges(wsId, 50);
      }
    } catch (err) {
      options.onStatus(`Failed to load changes: ${String(err)}`);
      records = [];
    }
    render();
  }

  function setVisible(visible: boolean): void {
    open = visible;
    hub.hidden = !visible;
    hub.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function openHub(filter?: { runId?: string; query?: string }): void {
    setVisible(true);
    runFilter = filter?.runId;
    if (filter?.query) {
      searchInput.value = filter.query;
    }
    title.textContent = runFilter ? "Changes (run)" : "Changes";
    void load(filter?.query ?? searchInput.value);
  }

  function close(): void {
    setVisible(false);
    runFilter = undefined;
  }

  backBtn.addEventListener("click", () => close());
  closeBtn.addEventListener("click", () => close());

  searchInput.addEventListener("input", () => {
    if (searchTimer) {
      clearTimeout(searchTimer);
    }
    searchTimer = setTimeout(() => {
      runFilter = undefined;
      void load(searchInput.value);
    }, 250);
  });

  const unsubscribe = subscribeMemoryStore(() => {
    if (open) {
      void load(searchInput.value);
    }
  });

  return {
    open: openHub,
    close,
    isOpen: () => open,
    destroy() {
      unsubscribe();
      hub.remove();
    },
  };
}
