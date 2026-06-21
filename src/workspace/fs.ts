import { invoke } from "@tauri-apps/api/core";

export async function createDir(path: string): Promise<void> {
  await invoke("create_dir", { path });
}

export async function createFile(
  path: string,
  content = "",
): Promise<void> {
  await invoke("create_file", { path, content });
}

export async function deletePath(
  path: string,
  recursive = false,
): Promise<void> {
  await invoke("delete_path", { path, recursive });
}

export async function renamePath(
  oldPath: string,
  newPath: string,
): Promise<void> {
  await invoke("rename_path", { old_path: oldPath, new_path: newPath });
}

export async function movePath(from: string, to: string): Promise<void> {
  await invoke("move_path", { from, to });
}

export async function saveFileDialog(): Promise<string | null> {
  return invoke<string | null>("save_file_dialog");
}

export function parentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) {
    return normalized;
  }
  return normalized.slice(0, idx);
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  const trimmed = dir.replace(/[/\\]+$/, "");
  return `${trimmed}${sep}${name}`;
}
