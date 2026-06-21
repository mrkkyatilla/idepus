import {
  acceptAllStaged,
  acceptStagedPatch,
  rejectAllStaged,
  rejectStagedPatch,
} from "../../agent/batch-review";
import {
  getPatchQueue,
  getStagedPatches,
  hasStagedPatches,
  subscribePatchQueue,
  type QueuedPatch,
} from "../../agent/patch-queue";
import { rollbackFile } from "../../agent/snapshot";
import { enterDiffReviewFromRaw } from "../../cmdk/diff-review";
import { patchTextForReview } from "../../agent/patch-fallback";
import { getLastUserTaskInput } from "../../agent/task-tracker";

export type PatchQueuePanelHost = {
  openFile: (path: string, fallbackContent?: string) => Promise<void>;
  onStatus: (message: string) => void;
  getEditorView: () => import("@codemirror/view").EditorView | null;
  getWorkspaceRoot: () => string | undefined;
  getActiveFilePath?: () => string | undefined;
};

const STATUS_ICON: Record<QueuedPatch["status"], string> = {
  pending: "○",
  reviewing: "◉",
  staged: "●",
  accepted: "✓",
  rejected: "✗",
  shadow_failed: "⚠",
};

function pathsMatch(expected: string, actual: string | undefined): boolean {
  if (!actual) {
    return false;
  }
  if (expected === actual) {
    return true;
  }
  const expectedName = expected.split(/[/\\]/).pop();
  const actualName = actual.split(/[/\\]/).pop();
  return Boolean(expectedName && actualName && expectedName === actualName);
}

export function mountPatchQueuePanel(
  hostEl: HTMLElement,
  panelHost: PatchQueuePanelHost,
): { render: () => void } {
  const root = document.createElement("div");
  root.className = "patch-queue-panel";
  root.hidden = true;

  const header = document.createElement("button");
  header.type = "button";
  header.className = "collapse-header patch-queue-header";
  header.textContent = "▾ Changes";

  const batchActions = document.createElement("div");
  batchActions.className = "patch-batch-actions";
  batchActions.hidden = true;

  const acceptAllBtn = document.createElement("button");
  acceptAllBtn.type = "button";
  acceptAllBtn.className = "btn btn-primary btn-sm";
  acceptAllBtn.textContent = "Accept all";
  acceptAllBtn.title = "Apply all staged changes";

  const rejectAllBtn = document.createElement("button");
  rejectAllBtn.type = "button";
  rejectAllBtn.className = "btn btn-ghost btn-sm";
  rejectAllBtn.textContent = "Reject all";
  rejectAllBtn.title = "Discard all staged changes";

  batchActions.append(acceptAllBtn, rejectAllBtn);

  const list = document.createElement("div");
  list.className = "patch-queue-list";

  root.append(header, batchActions, list);
  hostEl.appendChild(root);

  let collapsed = false;

  header.addEventListener("click", () => {
    collapsed = !collapsed;
    list.hidden = collapsed;
    batchActions.hidden = collapsed || !hasStagedPatches();
    header.textContent = collapsed ? "▸ Changes" : "▾ Changes";
  });

  acceptAllBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const rootPath = panelHost.getWorkspaceRoot();
    if (!rootPath) {
      panelHost.onStatus("Open a workspace folder first");
      return;
    }
    void acceptAllStaged(rootPath)
      .then(() => panelHost.onStatus("All changes applied"))
      .catch((err) => panelHost.onStatus(String(err)));
  });

  rejectAllBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    rejectAllStaged();
    panelHost.onStatus("All staged changes discarded");
  });

  async function previewPatch(item: QueuedPatch): Promise<void> {
    const relPath = item.path;
    const fileContentArg = item.approval.arguments.file_content;
    const fallbackContent =
      typeof fileContentArg === "string" &&
      !fileContentArg.startsWith("Workspace listing:")
        ? fileContentArg
        : undefined;
    await panelHost.openFile(relPath, fallbackContent);

    const view = panelHost.getEditorView();
    const activePath = panelHost.getActiveFilePath?.();
    if (!view || !pathsMatch(relPath, activePath)) {
      return;
    }

    const rawPatch = String(
      item.approval.arguments.raw_patch ?? item.approval.arguments.rawPatch ?? "",
    );
    const baseContent = view.state.doc.toString();
    const effectivePatch = patchTextForReview(
      rawPatch,
      baseContent,
      getLastUserTaskInput(),
    );
    try {
      await enterDiffReviewFromRaw(view, relPath, effectivePatch);
    } catch {
      // preview optional
    }
  }

  function renderItem(item: QueuedPatch): HTMLElement {
    const row = document.createElement("div");
    row.className = `patch-queue-item patch-queue-item--${item.status}`;

    const icon = document.createElement("span");
    icon.className = "patch-queue-icon";
    icon.textContent = STATUS_ICON[item.status];

    const label = document.createElement("span");
    label.className = "patch-queue-path";
    label.textContent = item.path.split(/[/\\]/).pop() ?? item.path;
    label.title = item.path;

    row.append(icon, label);

    if (item.status === "staged") {
      const actions = document.createElement("div");
      actions.className = "patch-queue-row-actions";

      const acceptBtn = document.createElement("button");
      acceptBtn.type = "button";
      acceptBtn.className = "patch-queue-btn patch-queue-btn--accept";
      acceptBtn.title = "Keep change";
      acceptBtn.textContent = "✓";
      acceptBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const rootPath = panelHost.getWorkspaceRoot();
        if (!rootPath) {
          panelHost.onStatus("Open a workspace folder first");
          return;
        }
        void acceptStagedPatch(item, rootPath)
          .then(() => panelHost.onStatus(`Applied ${item.path}`))
          .catch((err) => panelHost.onStatus(String(err)));
      });

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "patch-queue-btn patch-queue-btn--reject";
      rejectBtn.title = "Discard change";
      rejectBtn.textContent = "✗";
      rejectBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        rejectStagedPatch(item);
        panelHost.onStatus(`Discarded ${item.path}`);
      });

      actions.append(acceptBtn, rejectBtn);
      row.appendChild(actions);
    }

    if (item.snapshot && panelHost.getWorkspaceRoot() && item.status === "accepted") {
      const rollbackBtn = document.createElement("button");
      rollbackBtn.type = "button";
      rollbackBtn.className = "btn btn-ghost btn-sm";
      rollbackBtn.textContent = "Rollback";
      rollbackBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const rootPath = panelHost.getWorkspaceRoot();
        if (!rootPath || !item.snapshot) {
          return;
        }
        void rollbackFile(rootPath, item.path, item.snapshot).then(() => {
          panelHost.onStatus(`Rolled back ${item.path}`);
        });
      });
      row.appendChild(rollbackBtn);
    }

    row.addEventListener("click", () => {
      if (item.status === "staged" || item.status === "reviewing") {
        void previewPatch(item);
      } else {
        void panelHost.openFile(item.path);
      }
    });

    return row;
  }

  function render(): void {
    const items = getPatchQueue();
    const staged = getStagedPatches();
    root.hidden = items.length === 0;
    batchActions.hidden = collapsed || staged.length === 0;

    if (staged.length > 0) {
      header.textContent = collapsed
        ? `▸ Review changes (${staged.length})`
        : `▾ Review changes (${staged.length})`;
    } else {
      header.textContent = collapsed ? "▸ Changes" : "▾ Changes";
    }

    list.replaceChildren();
    for (const item of items) {
      list.appendChild(renderItem(item));
    }
  }

  subscribePatchQueue(render);
  render();

  return { render };
}
