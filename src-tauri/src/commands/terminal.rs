use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::terminal::{TerminalContext, TerminalCreateResult, TerminalState};

#[derive(serde::Deserialize)]
pub struct TerminalCreateRequest {
    pub cwd: String,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[tauri::command]
pub fn terminal_create(
    app: AppHandle,
    state: State<'_, TerminalState>,
    request: TerminalCreateRequest,
) -> Result<TerminalCreateResult, AppError> {
    state.create(
        app,
        request.cwd,
        request.cols.unwrap_or(80),
        request.rows.unwrap_or(24),
    )
}

#[derive(serde::Deserialize)]
pub struct TerminalWriteRequest {
    pub session_id: String,
    pub data: String,
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalState>,
    request: TerminalWriteRequest,
) -> Result<(), AppError> {
    state.write(&request.session_id, &request.data)
}

#[derive(serde::Deserialize)]
pub struct TerminalResizeRequest {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalState>,
    request: TerminalResizeRequest,
) -> Result<(), AppError> {
    state.resize(&request.session_id, request.cols, request.rows)
}

#[tauri::command]
pub fn terminal_destroy(
    state: State<'_, TerminalState>,
    session_id: String,
) -> Result<(), AppError> {
    state.destroy(&session_id)
}

#[derive(serde::Deserialize)]
pub struct GetTerminalContextRequest {
    pub session_id: String,
    pub line_count: Option<usize>,
}

#[tauri::command]
pub fn get_terminal_context(
    state: State<'_, TerminalState>,
    request: GetTerminalContextRequest,
) -> Result<TerminalContext, AppError> {
    state.context(&request.session_id, request.line_count)
}
