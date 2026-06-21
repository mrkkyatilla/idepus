use std::sync::mpsc;
use std::time::Duration;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::error::AppError;
use crate::workspace::{
    close_workspace as close_ws, get_recent_workspaces as load_recent, list_dir_for_workspace,
    open_workspace as open_ws, RecentWorkspace, WorkspaceInfo, WorkspaceState,
};

#[tauri::command]
pub async fn open_workspace(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    path: String,
) -> Result<WorkspaceInfo, AppError> {
    open_ws(app, &state, path)
}

#[tauri::command]
pub async fn close_workspace(state: State<'_, WorkspaceState>) -> Result<(), AppError> {
    close_ws(&state);
    Ok(())
}

#[tauri::command]
pub fn list_dir(
    state: State<WorkspaceState>,
    path: String,
    recursive: Option<bool>,
) -> Result<Vec<crate::workspace::FileEntry>, AppError> {
    list_dir_for_workspace(&state, &path, recursive.unwrap_or(false))
}

#[tauri::command]
pub fn get_recent_workspaces() -> Result<Vec<RecentWorkspace>, AppError> {
    load_recent()
}

#[tauri::command]
pub async fn open_directory_dialog(app: AppHandle) -> Result<Option<String>, AppError> {
    let (tx, rx) = mpsc::sync_channel(1);
    app.dialog()
        .file()
        .pick_folder(move |folder| {
            let _ = tx.send(folder);
        });

    let picked = rx
        .recv_timeout(Duration::from_secs(300))
        .map_err(|e| AppError::Workspace(e.to_string()))?;

    Ok(picked.and_then(|p| p.into_path().ok().map(|path| path.to_string_lossy().into_owned())))
}
