import { invoke } from "@tauri-apps/api/core";

export async function snapshotFile(
  workspaceRoot: string,
  relPath: string,
): Promise<string> {
  const abs = relPath.startsWith("/")
    ? relPath
    : `${workspaceRoot}/${relPath.replace(/^\.\//, "")}`;
  try {
    return await invoke<string>("read_file", { path: abs });
  } catch {
    return "";
  }
}

export async function rollbackFile(
  workspaceRoot: string,
  relPath: string,
  content: string,
): Promise<void> {
  const abs = relPath.startsWith("/")
    ? relPath
    : `${workspaceRoot}/${relPath.replace(/^\.\//, "")}`;
  await invoke("write_file", { path: abs, content });
}
