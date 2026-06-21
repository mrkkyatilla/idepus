use std::fs;
use std::path::{Path, PathBuf};

use ignore::gitignore::Gitignore;

use crate::error::AppError;
use crate::workspace::ignore::{is_default_ignored_name, is_ignored};
use crate::workspace::types::FileEntry;

pub fn canonicalize(path: &Path) -> Result<PathBuf, AppError> {
    fs::canonicalize(path).map_err(|e| AppError::Workspace(e.to_string()))
}

pub fn list_directory(
    path: &Path,
    workspace_root: &Path,
    matcher: &Gitignore,
    recursive: bool,
) -> Result<Vec<FileEntry>, AppError> {
    let canonical = canonicalize(path)?;
    let root_canonical = canonicalize(workspace_root)?;

    if !canonical.starts_with(&root_canonical) {
        return Err(AppError::Workspace(format!(
            "path outside workspace: {}",
            canonical.display()
        )));
    }

    if !canonical.is_dir() {
        return Err(AppError::Workspace(format!(
            "not a directory: {}",
            canonical.display()
        )));
    }

    if recursive {
        list_recursive(&canonical, workspace_root, matcher)
    } else {
        list_one_level(&canonical, workspace_root, matcher)
    }
}

fn list_one_level(
    dir: &Path,
    workspace_root: &Path,
    matcher: &Gitignore,
) -> Result<Vec<FileEntry>, AppError> {
    let mut entries = Vec::new();

    for entry in fs::read_dir(dir).map_err(|e| AppError::Io(e.to_string()))? {
        let entry = entry.map_err(|e| AppError::Io(e.to_string()))?;
        let file_type = entry
            .file_type()
            .map_err(|e| AppError::Io(e.to_string()))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = file_type.is_dir();

        if is_default_ignored_name(&name, is_dir) {
            continue;
        }

        if is_ignored(matcher, &path, is_dir) {
            continue;
        }

        let display_path = path
            .strip_prefix(workspace_root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        entries.push(FileEntry {
            path: path.to_string_lossy().to_string(),
            name,
            is_dir,
        });

        let _ = display_path;
    }

    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

fn list_recursive(
    dir: &Path,
    workspace_root: &Path,
    matcher: &Gitignore,
) -> Result<Vec<FileEntry>, AppError> {
    let mut entries = Vec::new();
    collect_recursive(dir, workspace_root, matcher, &mut entries)?;
    Ok(entries)
}

fn collect_recursive(
    dir: &Path,
    workspace_root: &Path,
    matcher: &Gitignore,
    out: &mut Vec<FileEntry>,
) -> Result<(), AppError> {
    for child in list_one_level(dir, workspace_root, matcher)? {
        let path = child.path.clone();
        let is_dir = child.is_dir;
        out.push(child);
        if is_dir {
            collect_recursive(Path::new(&path), workspace_root, matcher, out)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::ignore::build_gitignore;
    use std::fs;

    #[test]
    fn non_recursive_lists_immediate_children() {
        let dir = std::env::temp_dir().join("idepus-list-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::write(dir.join("README.md"), "hi").unwrap();

        let matcher = build_gitignore(&dir).unwrap();
        let entries = list_one_level(&dir, &dir, &matcher).unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();

        assert!(names.contains(&"src"));
        assert!(names.contains(&"README.md"));
        assert!(!names.contains(&"node_modules"));

        let _ = fs::remove_dir_all(&dir);
    }
}
