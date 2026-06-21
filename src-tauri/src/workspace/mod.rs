pub mod grep;
pub mod ignore;
mod list;
mod recent;
pub mod self_write;
pub mod state;
pub mod types;
mod watcher;

pub use state::WorkspaceState;
pub use types::{FileEntry, RecentWorkspace, WorkspaceInfo};

use std::path::Path;

use tauri::AppHandle;

use crate::error::AppError;
use crate::workspace::list::list_directory;
use crate::workspace::recent::load_recent;

pub fn list_dir_for_workspace(
    state: &WorkspaceState,
    path: &str,
    recursive: bool,
) -> Result<Vec<types::FileEntry>, AppError> {
    let root = state
        .root()
        .ok_or_else(|| AppError::Workspace("no workspace open".into()))?;
    let matcher = state
        .matcher()
        .ok_or_else(|| AppError::Workspace("no workspace open".into()))?;

    let target = if path.is_empty() {
        root.clone()
    } else {
        Path::new(path).to_path_buf()
    };

    list_directory(&target, &root, &matcher, recursive)
}

pub fn get_recent_workspaces() -> Result<Vec<types::RecentWorkspace>, AppError> {
    load_recent()
}

pub fn open_workspace(
    app: AppHandle,
    state: &WorkspaceState,
    path: String,
) -> Result<types::WorkspaceInfo, AppError> {
    state.open(app, &path)
}

pub fn close_workspace(state: &WorkspaceState) {
    state.close();
}
