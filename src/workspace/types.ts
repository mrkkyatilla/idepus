export type FileEntry = {
  path: string;
  name: string;
  is_dir: boolean;
};

export type WorkspaceInfo = {
  root_path: string;
  name: string;
  workspace_id: string;
};

export type RecentWorkspace = {
  path: string;
  name: string;
};

export type FileChangeKind = "created" | "modified" | "deleted" | "renamed";

export type FileChangeEvent = {
  path: string;
  kind: FileChangeKind;
  old_path?: string;
};

export type EditorTab = {
  id: string;
  path: string;
  name: string;
  dirty: boolean;
  content: string;
};
