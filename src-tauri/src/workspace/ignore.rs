use std::path::Path;

use ignore::gitignore::{Gitignore, GitignoreBuilder};

use crate::error::AppError;

const DEFAULT_IGNORES: &[&str] = &[
    "node_modules/",
    "target/",
    ".git/",
    ".idepus/",
];

pub fn build_gitignore(root: &Path) -> Result<Gitignore, AppError> {
    let mut builder = GitignoreBuilder::new(root);

    for pattern in DEFAULT_IGNORES {
        builder
            .add_line(None, pattern)
            .map_err(|e| AppError::Workspace(e.to_string()))?;
    }

    let gitignore_path = root.join(".gitignore");
    if gitignore_path.is_file() {
        let _ = builder.add(gitignore_path);
    }

    let idepusignore_path = root.join(".idepusignore");
    if idepusignore_path.is_file() {
        let _ = builder.add(idepusignore_path);
    }

    builder
        .build()
        .map_err(|e| AppError::Workspace(e.to_string()))
}

pub fn is_ignored(matcher: &Gitignore, path: &Path, is_dir: bool) -> bool {
    matcher.matched(path, is_dir).is_ignore()
}

pub fn is_default_ignored_name(name: &str, is_dir: bool) -> bool {
    if !is_dir {
        return false;
    }
    matches!(
        name,
        "node_modules" | "target" | ".git" | ".idepus"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn default_ignored_dir_names() {
        assert!(is_default_ignored_name("node_modules", true));
        assert!(is_default_ignored_name(".git", true));
        assert!(!is_default_ignored_name("src", true));
    }

    #[test]
    fn gitignore_filters_node_modules() {
        let dir = std::env::temp_dir().join("idepus-ignore-node-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::create_dir_all(dir.join("src")).unwrap();

        let matcher = build_gitignore(&dir).unwrap();
        assert!(is_ignored(&matcher, &dir.join("node_modules"), true));
        assert!(!is_ignored(&matcher, &dir.join("src"), true));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn idepusignore_excludes_custom_dir() {
        let dir = std::env::temp_dir().join("idepus-ignore-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("vendor")).unwrap();
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join(".idepusignore"), "vendor/\n").unwrap();

        let matcher = build_gitignore(&dir).unwrap();
        assert!(is_ignored(&matcher, &dir.join("vendor"), true));
        assert!(!is_ignored(&matcher, &dir.join("src"), true));

        let _ = fs::remove_dir_all(&dir);
    }
}
