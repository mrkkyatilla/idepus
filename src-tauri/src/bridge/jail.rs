use std::path::{Component, Path, PathBuf};

use crate::error::AppError;

fn reject_parent_traversal(path: &str) -> Result<(), AppError> {
    for component in Path::new(path).components() {
        if matches!(component, Component::ParentDir) {
            return Err(AppError::PermissionDenied(format!(
                "parent traversal not allowed: {path}"
            )));
        }
    }
    Ok(())
}

/// Join `path` under `workspace_root` without requiring the target to exist.
/// Rejects workspace root (`.` / empty) — patches must name a file.
pub fn resolve_path_in_workspace(workspace_root: &Path, path: &str) -> Result<PathBuf, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "." {
        return Err(AppError::Shadow(
            "path must name a file, not the workspace root".into(),
        ));
    }

    reject_parent_traversal(trimmed)?;

    let root = workspace_root
        .canonicalize()
        .map_err(|e| AppError::Workspace(format!("invalid workspace root: {e}")))?;

    let target = if Path::new(trimmed).is_absolute() {
        let mut normalized = PathBuf::new();
        for component in Path::new(trimmed).components() {
            match component {
                Component::Prefix(p) => normalized.push(p.as_os_str()),
                Component::RootDir => normalized.push(component.as_os_str()),
                Component::CurDir => {}
                Component::Normal(c) => normalized.push(c),
                Component::ParentDir => {
                    return Err(AppError::PermissionDenied(format!(
                        "parent traversal not allowed: {path}"
                    )));
                }
            }
        }
        normalized
    } else {
        let mut joined = root.clone();
        for component in Path::new(trimmed).components() {
            match component {
                Component::CurDir => {}
                Component::Normal(c) => joined.push(c),
                _ => {
                    return Err(AppError::PermissionDenied(format!(
                        "invalid path component in: {path}"
                    )));
                }
            }
        }
        joined
    };

    if !target.starts_with(&root) {
        return Err(AppError::PermissionDenied(format!(
            "path escapes workspace: {path}"
        )));
    }

    Ok(target)
}

pub fn resolve_in_workspace(workspace_root: &Path, path: &str) -> Result<PathBuf, AppError> {
    let root = workspace_root
        .canonicalize()
        .map_err(|e| AppError::Workspace(format!("invalid workspace root: {e}")))?;

    let target = if path.is_empty() {
        root.clone()
    } else {
        let joined = if Path::new(path).is_absolute() {
            PathBuf::from(path)
        } else {
            root.join(path)
        };
        joined
            .canonicalize()
            .map_err(|e| AppError::NotFound(format!("{path}: {e}")))?
    };

    if !target.starts_with(&root) {
        return Err(AppError::PermissionDenied(format!(
            "path escapes workspace: {path}"
        )));
    }

    reject_parent_traversal(path)?;

    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn resolve_path_rejects_workspace_root() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let err = resolve_path_in_workspace(tmp.path(), ".").unwrap_err();
        assert!(err.to_string().contains("workspace root"));
    }

    #[test]
    fn resolve_path_allows_nonexistent_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target = resolve_path_in_workspace(tmp.path(), "src/new.rs").expect("resolve");
        assert!(target.ends_with("src/new.rs"));
        assert!(!target.exists());
    }

    #[test]
    fn resolve_in_workspace_canonicalizes_existing_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let file = tmp.path().join("a.txt");
        fs::write(&file, "x").unwrap();
        let resolved = resolve_in_workspace(tmp.path(), "a.txt").expect("resolve");
        assert!(resolved.is_file());
    }
}
