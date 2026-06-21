use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::shadow::{CommandResult, ShadowPrepareResult, ShadowState};

#[derive(serde::Deserialize)]
pub struct ShadowPrepareRequest {
    pub workspace_id: String,
    pub workspace_root: String,
    pub files_to_modify: Option<Vec<String>>,
}

#[tauri::command]
pub fn shadow_prepare(
    state: State<'_, ShadowState>,
    request: ShadowPrepareRequest,
) -> Result<ShadowPrepareResult, AppError> {
    state.prepare(
        request.workspace_id,
        request.workspace_root,
        request.files_to_modify,
    )
}

#[derive(serde::Deserialize)]
pub struct ShadowApplyPatchRequest {
    pub shadow_id: String,
    pub path: String,
    pub raw_patch: String,
    pub file_content: String,
}

#[tauri::command]
pub fn shadow_apply_patch(
    state: State<'_, ShadowState>,
    request: ShadowApplyPatchRequest,
) -> Result<(), AppError> {
    state.apply_patch(
        &request.shadow_id,
        &request.path,
        &request.raw_patch,
        &request.file_content,
    )
}

#[derive(serde::Deserialize)]
pub struct ShadowRunCommandRequest {
    pub shadow_id: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub timeout_secs: Option<u64>,
}

#[tauri::command]
pub fn shadow_run_command(
    app: AppHandle,
    state: State<'_, ShadowState>,
    request: ShadowRunCommandRequest,
) -> Result<CommandResult, AppError> {
    state.run_command(
        &app,
        &request.shadow_id,
        request.command,
        request.args,
        request.timeout_secs,
    )
}

#[tauri::command]
pub fn shadow_discard(
    state: State<'_, ShadowState>,
    shadow_id: String,
) -> Result<(), AppError> {
    state.discard(&shadow_id)
}
