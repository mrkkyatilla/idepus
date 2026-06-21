use std::path::Path;

use crate::config::{load_team_context, load_workflow_config, TeamContext, WorkflowConfig};
use crate::error::AppError;
use crate::workspace::WorkspaceState;
use tauri::State;

#[tauri::command]
pub fn load_workflow_config_cmd(
    state: State<'_, WorkspaceState>,
    workspace_root: Option<String>,
) -> Result<WorkflowConfig, AppError> {
    let root = resolve_root(&state, workspace_root)?;
    Ok(load_workflow_config(&root))
}

#[tauri::command]
pub fn load_team_context_cmd(
    state: State<'_, WorkspaceState>,
    workspace_root: Option<String>,
) -> Result<TeamContext, AppError> {
    let root = resolve_root(&state, workspace_root)?;
    Ok(load_team_context(&root))
}

fn resolve_root(
    state: &WorkspaceState,
    workspace_root: Option<String>,
) -> Result<std::path::PathBuf, AppError> {
    if let Some(root) = workspace_root {
        let path = Path::new(&root);
        if path.is_dir() {
            return Ok(path.to_path_buf());
        }
        return Err(AppError::Workspace(format!(
            "workspace_root is not a directory: {root}"
        )));
    }
    state
        .root()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| AppError::Workspace("no workspace open".into()))
}
