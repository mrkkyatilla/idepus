use std::fs;
use std::path::{Path, PathBuf};

use crate::bridge::jail::resolve_path_in_workspace;
use crate::error::AppError;

const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".idea",
    ".cursor",
];

pub fn shadow_root_for_workspace(workspace_id: &str) -> PathBuf {
    std::env::temp_dir()
        .join("idepus-shadow")
        .join(workspace_id)
}

pub fn prepare_tree(workspace_root: &Path, shadow_root: &Path) -> Result<(), AppError> {
    if shadow_root.exists() {
        fs::remove_dir_all(shadow_root).map_err(|e| AppError::Shadow(e.to_string()))?;
    }
    fs::create_dir_all(shadow_root).map_err(|e| AppError::Shadow(e.to_string()))?;

    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|e| AppError::Shadow(format!("canonicalize workspace: {e}")))?;

    mirror_dir(&canonical_root, shadow_root)?;
    Ok(())
}

fn mirror_dir(source_dir: &Path, shadow_dir: &Path) -> Result<(), AppError> {
    fs::create_dir_all(shadow_dir).map_err(|e| AppError::Shadow(e.to_string()))?;

    for entry in fs::read_dir(source_dir).map_err(|e| AppError::Shadow(e.to_string()))? {
        let entry = entry.map_err(|e| AppError::Shadow(e.to_string()))?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if SKIP_DIRS.contains(&name_str.as_ref()) {
            continue;
        }
        if name_str.starts_with('.') && entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        let source_path = entry.path();
        let shadow_path = shadow_dir.join(&name);

        if source_path.is_dir() {
            mirror_dir(&source_path, &shadow_path)?;
        } else if source_path.is_file() {
            link_or_copy_file(&source_path, &shadow_path)?;
        }
    }
    Ok(())
}

fn link_or_copy_file(source: &Path, dest: &Path) -> Result<(), AppError> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Shadow(e.to_string()))?;
    }

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, dest)
            .map_err(|e| AppError::Shadow(format!("symlink {}: {e}", dest.display())))?;
    }

    #[cfg(not(unix))]
    {
        fs::copy(source, dest).map_err(|e| AppError::Shadow(e.to_string()))?;
    }

    Ok(())
}

pub fn shadow_path_for(workspace_root: &Path, shadow_root: &Path, rel_path: &str) -> Result<PathBuf, AppError> {
    let resolved = resolve_path_in_workspace(workspace_root, rel_path)?;
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|e| AppError::Shadow(e.to_string()))?;
    let rel = resolved
        .strip_prefix(&canonical_root)
        .map_err(|_| AppError::Shadow(format!("path not under workspace: {rel_path}")))?;
    Ok(shadow_root.join(rel))
}

/// Ensure patched paths exist in the shadow tree (parent dirs + source file copy).
pub fn ensure_shadow_files(
    workspace_root: &Path,
    shadow_root: &Path,
    files: &[String],
) -> Result<(), AppError> {
    for rel in files {
        let workspace_path = resolve_path_in_workspace(workspace_root, rel)?;
        if workspace_path.exists() && workspace_path.is_dir() {
            return Err(AppError::Shadow(format!("cannot patch directory: {rel}")));
        }

        let shadow_file = shadow_path_for(workspace_root, shadow_root, rel)?;
        if shadow_file.exists() && shadow_file.is_dir() {
            return Err(AppError::Shadow(format!("cannot patch directory: {rel}")));
        }

        if let Some(parent) = shadow_file.parent() {
            fs::create_dir_all(parent).map_err(|e| AppError::Shadow(e.to_string()))?;
        }

        if workspace_path.is_file() && !shadow_file.exists() {
            link_or_copy_file(&workspace_path, &shadow_file)?;
        }
    }
    Ok(())
}

pub fn ensure_writable_shadow_file(path: &Path) -> Result<(), AppError> {
    if path.exists() {
        if path.is_dir() {
            return Err(AppError::Shadow(format!(
                "cannot patch directory: {}",
                path.display()
            )));
        }
        if path.is_symlink() {
            let target = fs::read_link(path).map_err(|e| AppError::Shadow(e.to_string()))?;
            if Path::new(&target).is_dir() {
                return Err(AppError::Shadow(format!(
                    "cannot patch directory symlink: {}",
                    path.display()
                )));
            }
            let content = fs::read(&target).map_err(|e| AppError::Shadow(e.to_string()))?;
            fs::remove_file(path).map_err(|e| AppError::Shadow(e.to_string()))?;
            fs::write(path, content).map_err(|e| AppError::Shadow(e.to_string()))?;
        }
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Shadow(e.to_string()))?;
    }
    Ok(())
}

pub fn discard_tree(shadow_root: &Path) -> Result<(), AppError> {
    if shadow_root.exists() {
        fs::remove_dir_all(shadow_root).map_err(|e| AppError::Shadow(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn prepare_creates_symlink_tree() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let workspace = tmp.path().join("ws");
        let src_file = workspace.join("src").join("main.rs");
        fs::create_dir_all(src_file.parent().unwrap()).unwrap();
        fs::write(&src_file, "fn main() {}\n").unwrap();

        let shadow = tmp.path().join("shadow");
        prepare_tree(&workspace, &shadow).unwrap();

        let shadow_file = shadow.join("src").join("main.rs");
        assert!(shadow_file.exists());
        #[cfg(unix)]
        assert!(shadow_file.is_symlink());
    }
}
