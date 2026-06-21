use std::fs;
use std::path::{Path, PathBuf};

use tauri::State;

use crate::bridge::jail::resolve_path_in_workspace;
use crate::commands::file::write_atomic;
use crate::error::AppError;
use crate::workspace::WorkspaceState;

fn workspace_root(state: &WorkspaceState) -> Result<PathBuf, AppError> {
    state
        .root()
        .ok_or_else(|| AppError::Workspace("no workspace open".into()))
}

fn resolve_in_open_workspace(state: &WorkspaceState, path: &str) -> Result<PathBuf, AppError> {
    let root = workspace_root(state)?;
    resolve_path_in_workspace(&root, path)
}

fn is_protected_delete(target: &Path, root: &Path) -> bool {
    if target == root {
        return true;
    }
    target
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n == ".git")
        .unwrap_or(false)
}

pub fn create_dir_impl(state: &WorkspaceState, path: &str) -> Result<(), AppError> {
    let root = workspace_root(state)?;
    let target = resolve_path_in_workspace(&root, path)?;
    fs::create_dir_all(&target).map_err(AppError::from)?;
    state.record_self_write(&target);
    Ok(())
}

pub fn create_file_impl(
    state: &WorkspaceState,
    path: &str,
    content: Option<String>,
) -> Result<(), AppError> {
    let root = workspace_root(state)?;
    let target = resolve_path_in_workspace(&root, path)?;
    if target.exists() {
        return Err(AppError::Io(format!("file already exists: {path}")));
    }
    let bytes = content.unwrap_or_default().into_bytes();
    write_atomic(&target, &bytes)?;
    state.record_self_write(&target);
    Ok(())
}

pub fn delete_path_impl(
    state: &WorkspaceState,
    path: &str,
    recursive: bool,
) -> Result<(), AppError> {
    let root = workspace_root(state)?;
    let target = resolve_in_open_workspace(state, path)?;
    if !target.exists() {
        return Err(AppError::NotFound(path.to_string()));
    }
    if is_protected_delete(&target, &root) {
        return Err(AppError::PermissionDenied(format!(
            "cannot delete protected path: {path}"
        )));
    }

    if target.is_dir() {
        if recursive {
            fs::remove_dir_all(&target).map_err(AppError::from)?;
        } else {
            fs::remove_dir(&target).map_err(AppError::from)?;
        }
    } else {
        fs::remove_file(&target).map_err(AppError::from)?;
    }
    state.record_self_write(&target);
    Ok(())
}

pub fn rename_path_impl(
    state: &WorkspaceState,
    old_path: &str,
    new_path: &str,
) -> Result<(), AppError> {
    let root = workspace_root(state)?;
    let from = resolve_in_open_workspace(state, old_path)?;
    let to = resolve_path_in_workspace(&root, new_path)?;
    if !from.exists() {
        return Err(AppError::NotFound(old_path.to_string()));
    }
    if to.exists() {
        return Err(AppError::Io(format!(
            "destination already exists: {new_path}"
        )));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(AppError::from)?;
    }
    fs::rename(&from, &to).map_err(AppError::from)?;
    state.record_self_write(&from);
    state.record_self_write(&to);
    Ok(())
}

#[tauri::command]
pub fn create_dir(state: State<'_, WorkspaceState>, path: String) -> Result<(), AppError> {
    create_dir_impl(&state, &path)
}

#[tauri::command]
pub fn create_file(
    state: State<'_, WorkspaceState>,
    path: String,
    content: Option<String>,
) -> Result<(), AppError> {
    create_file_impl(&state, &path, content)
}

#[tauri::command]
pub fn delete_path(
    state: State<'_, WorkspaceState>,
    path: String,
    recursive: Option<bool>,
) -> Result<(), AppError> {
    delete_path_impl(&state, &path, recursive.unwrap_or(false))
}

#[tauri::command]
pub fn rename_path(
    state: State<'_, WorkspaceState>,
    old_path: String,
    new_path: String,
) -> Result<(), AppError> {
    rename_path_impl(&state, &old_path, &new_path)
}

#[tauri::command]
pub fn move_path(
    state: State<'_, WorkspaceState>,
    from: String,
    to: String,
) -> Result<(), AppError> {
    rename_path_impl(&state, &from, &to)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_root_detection() {
        let tmp = tempfile::tempdir().expect("tempdir");
        assert!(is_protected_delete(tmp.path(), tmp.path()));
    }

    #[test]
    fn create_file_and_delete_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = WorkspaceState::new();
        state.set_root_for_test(dir.path().to_path_buf());

        create_file_impl(&state, "src/hello.txt", Some("hi".into())).expect("create");
        let path = dir.path().join("src/hello.txt");
        assert!(path.is_file());

        delete_path_impl(&state, "src/hello.txt", false).expect("delete");
        assert!(!path.exists());
    }

    #[test]
    fn delete_workspace_root_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = WorkspaceState::new();
        state.set_root_for_test(dir.path().to_path_buf());
        let err = delete_path_impl(
            &state,
            &dir.path().to_string_lossy(),
            true,
        )
        .unwrap_err();
        assert!(err.to_string().contains("protected"));
    }
}
