use idepus_diff::{apply_hunks, resolve_patch, Patch, PatchError, PatchHunk};
use serde::Deserialize;

use crate::commands::file::write_atomic;
use crate::error::AppError;

#[derive(Debug, Deserialize)]
pub struct ParsePatchRequest {
    pub raw_llm_output: String,
    pub file_path: String,
    pub file_content: String,
}

#[derive(Debug, Deserialize)]
pub struct ApplyPatchHunksRequest {
    pub path: String,
    pub file_content: String,
    pub hunks: Vec<PatchHunk>,
    pub accepted_ids: Vec<String>,
}

#[tauri::command]
pub fn parse_patch(request: ParsePatchRequest) -> Result<Patch, AppError> {
    resolve_patch(
        &request.raw_llm_output,
        &request.file_path,
        &request.file_content,
    )
    .map_err(map_patch_error)
}

#[tauri::command]
pub fn apply_patch_hunks(request: ApplyPatchHunksRequest) -> Result<String, AppError> {
    let new_content = apply_hunks(
        &request.file_content,
        &request.hunks,
        &request.accepted_ids,
    )
    .map_err(map_patch_error)?;

    write_atomic(
        std::path::Path::new(&request.path),
        new_content.as_bytes(),
    )?;

    Ok(new_content)
}

#[tauri::command]
pub fn reject_patch(_patch_id: String) -> Result<(), AppError> {
    Ok(())
}

fn map_patch_error(err: PatchError) -> AppError {
    AppError::Patch(err.to_string())
}
