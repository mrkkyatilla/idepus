import type { AgentRunRecord } from "../../agent/types";

function statusBadgeClass(status: string): string {
  if (status === "completed") {
    return "badge badge-success";
  }
  if (status === "failed" || status === "error") {
    return "badge badge-danger";
  }
  if (status === "cancelled") {
    return "badge badge-muted";
  }
  return "badge badge-warning";
}

export function mountHistory(hostEl: HTMLElement): {
  render: (runs: AgentRunRecord[]) => void;
  setCollapsed: (collapsed: boolean) => void;
} {
  const section = document.createElement("div");
  section.className = "agent-history";

  let collapsed = false;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "collapse-header";
  toggle.textContent = "▾ Recent runs";

  const list = document.createElement("div");
  list.className = "agent-history-list";

  toggle.addEventListener("click", () => {
    collapsed = !collapsed;
    list.hidden = collapsed;
    toggle.textContent = collapsed ? "▸ Recent runs" : "▾ Recent runs";
  });

  section.append(toggle, list);
  hostEl.appendChild(section);

  return {
    render(runs: AgentRunRecord[]) {
      list.innerHTML = "";
      if (runs.length === 0) {
        section.hidden = true;
        return;
      }
      section.hidden = false;

      for (const run of runs) {
        const item = document.createElement("div");
        item.className = "agent-history-item";
        item.title = run.output ? `${run.runId}\n${run.output}` : run.runId;

        const prompt = document.createElement("div");
        prompt.className = "agent-history-prompt";
        prompt.textContent = run.input;

        const meta = document.createElement("div");
        meta.className = "agent-history-meta";

        const badge = document.createElement("span");
        badge.className = statusBadgeClass(run.status);
        badge.textContent = run.status;

        meta.append(badge);
        if (run.output && run.status !== "completed") {
          const err = document.createElement("span");
          err.className = "agent-history-error";
          err.textContent = ` — ${run.output}`;
          meta.append(err);
        }

        item.append(prompt, meta);
        list.appendChild(item);
      }
    },
    setCollapsed(value: boolean) {
      collapsed = value;
      list.hidden = collapsed;
      toggle.textContent = collapsed ? "▸ Recent runs" : "▾ Recent runs";
    },
  };
}
