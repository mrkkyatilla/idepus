import { isSemanticMemoryAvailable } from "../memory/persist";
import {
  fetchMemories,
  forgetMemoryRecord,
  pinMemoryRecord,
} from "../memory/store";
import type { MemoryRecord } from "../memory/types";

export function mountSettingsMemoriesView(
  modalEl: HTMLElement,
  options: {
    workspaceId: string | undefined;
    onStatus: (message: string) => void;
    onOpenFile?: (path: string) => void;
  },
): { show: () => void; hide: () => void } {
  const view = document.createElement("div");
  view.className = "settings-memories-view agent-chat-hub";
  view.hidden = true;

  const header = document.createElement("div");
  header.className = "agent-chat-hub-header";

  const title = document.createElement("h3");
  title.className = "agent-chat-hub-title";
  title.textContent = "Memories";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "btn btn-ghost btn-sm";
  backBtn.textContent = "Back";

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn btn-ghost btn-sm";
  exportBtn.textContent = "Export";

  header.append(title, exportBtn, backBtn);

  const notice = document.createElement("p");
  notice.className = "settings-memories-notice";

  const list = document.createElement("div");
  list.className = "agent-chat-hub-list memory-settings-list";
  view.append(header, notice, list);
  modalEl.appendChild(view);

  let records: MemoryRecord[] = [];

  async function refreshNotice(): Promise<void> {
    const semantic = await isSemanticMemoryAvailable();
    notice.textContent = semantic
      ? "Structured memories from chat decisions and facts. Pin important items."
      : "Semantic index offline — keyword search only. Memories are stored locally.";
  }

  function render(): void {
    list.innerHTML = "";
    if (records.length === 0) {
      const empty = document.createElement("p");
      empty.className = "agent-chat-hub-empty";
      empty.textContent =
        "No memories yet. Chat decisions and facts are extracted over time.";
      list.appendChild(empty);
      return;
    }

    for (const record of records) {
      const row = document.createElement("div");
      row.className = "agent-chat-hub-row memory-settings-row";

      const main = document.createElement("div");
      main.className = "agent-chat-hub-row-main";

      const rowTitle = document.createElement("span");
      rowTitle.className = "agent-chat-hub-row-title";
      rowTitle.textContent = record.text;

      const meta = document.createElement("span");
      meta.className = "agent-chat-hub-row-meta";
      meta.textContent = new Date(record.createdAt).toLocaleString();

      main.append(rowTitle, meta);

      const badge = document.createElement("span");
      badge.className = `agent-chat-hub-mode agent-chat-hub-mode--${record.type}`;
      badge.textContent = record.type;

      const actions = document.createElement("div");
      actions.className = "memory-settings-actions";

      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = "btn btn-ghost btn-sm";
      pinBtn.textContent = record.pinned ? "Pinned" : "Pin";
      pinBtn.disabled = record.pinned;
      pinBtn.addEventListener("click", () => {
        if (!options.workspaceId) {
          return;
        }
        void pinMemoryRecord(options.workspaceId, record.id).then(() => {
          options.onStatus("Memory pinned");
          void load();
        });
      });

      const forgetBtn = document.createElement("button");
      forgetBtn.type = "button";
      forgetBtn.className = "btn btn-ghost btn-sm";
      forgetBtn.textContent = "Forget";
      forgetBtn.addEventListener("click", () => {
        if (!options.workspaceId) {
          return;
        }
        void forgetMemoryRecord(options.workspaceId, record.id).then(() => {
          options.onStatus("Memory forgotten");
          void load();
        });
      });

      actions.append(pinBtn, forgetBtn);

      if (record.refs.length > 0) {
        const refs = document.createElement("div");
        refs.className = "memory-settings-refs";
        for (const ref of record.refs) {
          const link = document.createElement("button");
          link.type = "button";
          link.className = "btn btn-ghost btn-sm";
          link.textContent = ref;
          link.addEventListener("click", () => options.onOpenFile?.(ref));
          refs.appendChild(link);
        }
        row.append(main, badge, refs, actions);
      } else {
        row.append(main, badge, actions);
      }

      list.appendChild(row);
    }
  }

  async function load(): Promise<void> {
    if (!options.workspaceId) {
      records = [];
      render();
      return;
    }
    records = await fetchMemories(options.workspaceId);
    render();
  }

  exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(records, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "idepus-memories.json";
    a.click();
    URL.revokeObjectURL(url);
    options.onStatus("Memories exported");
  });

  backBtn.addEventListener("click", () => hide());

  function show(): void {
    view.hidden = false;
    void refreshNotice();
    void load();
  }

  function hide(): void {
    view.hidden = true;
  }

  return { show, hide };
}
