import { invoke } from "@tauri-apps/api/core";

import { listRecentChanges } from "../memory/persist";

export type MentionKind = "file" | "folder" | "docs" | "changes";

export type MentionRequest = {
  kind: MentionKind;
  path: string;
};

export type MentionChip = MentionRequest & { label: string };

export const IDEPUS_PATH_MIME = "application/x-idepus-path";

export type IdepusPathDragPayload = {
  kind: "file" | "folder";
  absPath: string;
  relPath: string;
  name: string;
};

type MentionSuggestion = {
  kind: MentionKind;
  path: string;
  label: string;
};

let mentionList: MentionChip[] = [];
const mentionSubscribers = new Set<() => void>();
let chipsRenderer: ((baseValue: string) => void) | null = null;
let chipsInputValue = "";

function notifyMentionSubscribers(): void {
  for (const listener of mentionSubscribers) {
    listener();
  }
  chipsRenderer?.(chipsInputValue);
}

export function getMentions(): MentionRequest[] {
  return mentionList.map(({ kind, path }) => ({ kind, path }));
}

export function clearMentions(): void {
  mentionList = [];
}

export function subscribeMentions(listener: () => void): () => void {
  mentionSubscribers.add(listener);
  return () => mentionSubscribers.delete(listener);
}

export function relWorkspacePath(absPath: string, workspaceRoot?: string): string | null {
  if (!workspaceRoot) {
    return absPath;
  }
  const root = workspaceRoot.replace(/\/$/, "");
  if (absPath.startsWith(`${root}/`)) {
    return absPath.slice(root.length + 1);
  }
  if (absPath === root) {
    return "";
  }
  return null;
}

export function addMention(
  request: MentionRequest & { label?: string },
): boolean {
  const path = request.path.replace(/\\/g, "/").replace(/\/$/, "") || request.path;
  if (
    mentionList.some(
      (m) => m.path === path && m.kind === request.kind,
    )
  ) {
    return false;
  }
  const baseName = path.split(/[/\\]/).pop() ?? path;
  const label =
    request.label ??
    (request.kind === "folder" ? `@${baseName}/` : `@${baseName}`);
  mentionList.push({
    kind: request.kind,
    path,
    label,
  });
  notifyMentionSubscribers();
  return true;
}

export function removeMention(path: string): void {
  const before = mentionList.length;
  mentionList = mentionList.filter((m) => m.path !== path);
  if (mentionList.length !== before) {
    notifyMentionSubscribers();
  }
}

function parseMentionToken(value: string): { prefix: string; query: string } | null {
  const at = value.lastIndexOf("@");
  if (at === -1) {
    return null;
  }
  const before = value.slice(0, at);
  if (at > 0 && !/\s/.test(value[at - 1]!)) {
    return null;
  }
  const query = value.slice(at + 1);
  if (query.includes(" ")) {
    return null;
  }
  return { prefix: before, query };
}

async function fetchSuggestions(
  query: string,
  workspaceRoot?: string,
  workspaceId?: string,
): Promise<MentionSuggestion[]> {
  const q = query.toLowerCase();
  const out: MentionSuggestion[] = [];

  if ("changes".startsWith(q) || q === "" || q.startsWith("chg")) {
    out.push({
      kind: "changes",
      path: "recent",
      label: "@changes (recent accepted)",
    });
  }

  if ("docs".startsWith(q) || q === "") {
    out.push({ kind: "docs", path: "README.md", label: "@docs (README.md)" });
  }

  function toRel(absPath: string): string {
    return relWorkspacePath(absPath, workspaceRoot) ?? absPath;
  }

  try {
    const entries = await invoke<Array<{ path: string; name: string; is_dir: boolean }>>(
      "list_dir",
      { path: "", recursive: true },
    );
    for (const entry of entries) {
      const rel = toRel(entry.path);
      if (q && !rel.toLowerCase().includes(q) && !entry.name.toLowerCase().includes(q)) {
        continue;
      }
      const kind: MentionKind = entry.is_dir ? "folder" : "file";
      const display = entry.is_dir ? `${entry.name}/` : entry.name;
      out.push({
        kind,
        path: rel,
        label: `@${display}`,
      });
      if (out.length >= 12) {
        break;
      }
    }
  } catch {
    // workspace may be closed
  }

  if (workspaceRoot) {
    try {
      const pluginSuggestions = await invoke<
        Array<{ kind: string; path: string; label: string }>
      >("list_context_sources", { query, workspaceRoot });
      for (const item of pluginSuggestions) {
        if (q && !item.label.toLowerCase().includes(q)) {
          continue;
        }
        out.push({
          kind: item.kind === "gitignore" ? "file" : (item.kind as MentionKind),
          path: item.path,
          label: item.label,
        });
      }
    } catch {
      // plugins optional
    }
  }

  if (workspaceId && (q === "" || "changes".startsWith(q) || q.startsWith("chg"))) {
    try {
      const recent = await listRecentChanges(workspaceId, 8);
      for (const change of recent) {
        const label = `@${change.path}`;
        if (q && !label.toLowerCase().includes(q) && !change.summary.toLowerCase().includes(q)) {
          continue;
        }
        out.push({
          kind: "changes",
          path: change.path,
          label: `${label} — ${change.summary.slice(0, 40)}`,
        });
        if (out.length >= 12) {
          break;
        }
      }
    } catch {
      // changes store optional
    }
  }

  return out.slice(0, 12);
}

type MentionInput = HTMLInputElement | HTMLTextAreaElement;

export function renderMentionChips(
  chipsContainer: HTMLElement,
  baseValue: string,
  onChange: (value: string) => void,
): void {
  chipsContainer.innerHTML = "";
  for (const mention of mentionList) {
    const chip = document.createElement("span");
    chip.className = "mention-chip";
    chip.textContent = mention.label;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      removeMention(mention.path);
    });
    chip.appendChild(remove);
    chipsContainer.appendChild(chip);
  }
  onChange(baseValue);
}

export function attachMentionAutocomplete(
  input: MentionInput,
  chipsContainer: HTMLElement,
  workspaceRoot: string | undefined,
  onChange: (value: string) => void,
  workspaceId?: string,
): () => void {
  let menu: HTMLElement | null = null;

  function renderChips(baseValue: string) {
    chipsInputValue = baseValue;
    renderMentionChips(chipsContainer, baseValue, onChange);
  }

  chipsRenderer = renderChips;
  const unsubMentions = subscribeMentions(() => renderChips(input.value));

  function closeMenu() {
    menu?.remove();
    menu = null;
  }

  async function openMenu(query: string) {
    closeMenu();
    const suggestions = await fetchSuggestions(query, workspaceRoot, workspaceId);
    if (suggestions.length === 0) {
      return;
    }

    menu = document.createElement("div");
    menu.className = "mention-menu";
    for (const item of suggestions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item.label;
      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const token = parseMentionToken(input.value);
        const base = token ? token.prefix : input.value;
        input.value = base.trim() ? `${base.trim()} ` : "";
        addMention({ kind: item.kind, path: item.path, label: item.label });
        closeMenu();
        input.focus();
      });
      menu.appendChild(btn);
    }
    input.parentElement?.appendChild(menu);
  }

  const onInput = () => {
    const token = parseMentionToken(input.value);
    if (token) {
      void openMenu(token.query);
    } else {
      closeMenu();
    }
    renderChips(input.value);
  };

  input.addEventListener("input", onInput);
  input.addEventListener("blur", () => window.setTimeout(closeMenu, 150));
  renderChips(input.value);

  return () => {
    input.removeEventListener("input", onInput);
    closeMenu();
    unsubMentions();
    if (chipsRenderer === renderChips) {
      chipsRenderer = null;
    }
  };
}

const FILE_EXT_PATTERN =
  /@?[\w./-]+\.(?:ts|tsx|js|jsx|rs|py|md|json|yaml|yml|toml|sh|bat|ps1|html|htm|css|vue|svg)\b/gi;

const TURKISH_FILE_PATTERN =
  /\b([\w.-]+)\s+dosyas(?:ı|ına|ını|ında|asına|ası|ıyla|iyle)\b/gi;

const SCOPE_FILE_PATTERN =
  /(?:only focus on|just edit|only edit|focus on|sadece|yalnızca)\s+(@?[\w./-]+)/gi;

const SCOPE_ILGILEN_PATTERN =
  /(?:sadece|yalnızca)\s+([\w./-]+)\s+ile\s+ilgilen/gi;

function stripCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ");
}

function normalizeScopeName(name: string): string {
  const cleaned = name.replace(/^@/, "").replace(/\\/g, "/");
  if (!cleaned) {
    return cleaned;
  }
  if (cleaned.includes(".")) {
    return cleaned;
  }
  return `${cleaned}.md`;
}

export type TargetFilesContext = {
  activeFilePath?: string;
  workspaceRoot?: string;
};

export function extractFilenameHints(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const source = stripCodeFences(text);

  const add = (raw: string) => {
    const path = normalizeScopeName(raw);
    const key = path.toLowerCase();
    if (!path || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(path);
  };

  for (const match of source.match(FILE_EXT_PATTERN) ?? []) {
    add(match);
  }

  for (const match of source.matchAll(TURKISH_FILE_PATTERN)) {
    const name = match[1] ?? "";
    if (name) {
      add(name);
    }
  }

  for (const match of source.matchAll(SCOPE_FILE_PATTERN)) {
    const name = match[1] ?? "";
    if (name) {
      add(name);
    }
  }

  for (const match of source.matchAll(SCOPE_ILGILEN_PATTERN)) {
    const name = match[1] ?? "";
    if (name) {
      add(name);
    }
  }

  return out;
}

export function formatTargetFilesBlock(
  input: string,
  mentions: MentionRequest[],
  context?: TargetFilesContext,
): string {
  const paths = new Set<string>();

  for (const mention of mentions) {
    if (mention.kind === "file" || mention.kind === "docs" || mention.kind === "folder") {
      paths.add(mention.path.replace(/\/$/, ""));
    }
  }

  for (const hint of extractFilenameHints(input)) {
    paths.add(hint);
  }

  const activeRel = context?.activeFilePath
    ? relWorkspacePath(context.activeFilePath, context.workspaceRoot)
    : null;
  if (activeRel && paths.size === 0) {
    paths.add(activeRel);
  }

  if (paths.size === 0) {
    return "";
  }

  const lines = [...paths].map((path) => `- ${path}`);
  return `[Target files]\n${lines.join("\n")}\n\n`;
}

export function formatChangesMentionBlock(
  changes: Array<{ path: string; summary: string; acceptedAt: number }>,
): string {
  if (changes.length === 0) {
    return "[Recent changes]\n(none)";
  }
  const lines = changes.map(
    (c) => `- ${c.path}: ${c.summary}`,
  );
  return `[Recent changes]\n${lines.join("\n")}`;
}

export function resetMentionsForPrompt(): void {
  clearMentions();
  notifyMentionSubscribers();
}

export function parseIdepusPathDrag(
  dataTransfer: DataTransfer,
): IdepusPathDragPayload | null {
  const raw = dataTransfer.getData(IDEPUS_PATH_MIME);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as IdepusPathDragPayload;
  } catch {
    return null;
  }
}
