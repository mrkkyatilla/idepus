use std::fs;
use std::path::Path;

use idepus_diff::{apply_hunks, resolve_patch};

use crate::error::AppError;
use crate::shadow::prepare::{ensure_writable_shadow_file, shadow_path_for};

pub fn apply_patch_to_shadow(
    workspace_root: &Path,
    shadow_root: &Path,
    path: &str,
    raw_patch: &str,
    file_content: &str,
) -> Result<String, AppError> {
    let shadow_file = shadow_path_for(workspace_root, shadow_root, path)?;
    ensure_writable_shadow_file(&shadow_file)?;

    let patch = resolve_patch(raw_patch, path, file_content)
        .map_err(|e| AppError::Patch(e.to_string()))?;

    let accepted: Vec<String> = patch.hunks.iter().map(|h| h.id.clone()).collect();
    let new_content = apply_hunks(file_content, &patch.hunks, &accepted)
        .map_err(|e| AppError::Patch(e.to_string()))?;

    if let Some(parent) = shadow_file.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Shadow(e.to_string()))?;
    }
    fs::write(&shadow_file, &new_content).map_err(|e| AppError::Shadow(e.to_string()))?;
    Ok(new_content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn apply_patch_updates_shadow_not_original() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let workspace = tmp.path().join("ws");
        let src_file = workspace.join("src").join("main.rs");
        fs::create_dir_all(src_file.parent().unwrap()).unwrap();
        fs::write(&src_file, "fn main() {}\n").unwrap();

        let shadow = tmp.path().join("shadow");
        crate::shadow::prepare::prepare_tree(&workspace, &shadow).unwrap();

        let raw_patch = "<<<<<<< SEARCH\nfn main() {}\n=======\nfn main() {\n    // patched\n}\n>>>>>>> REPLACE";
        apply_patch_to_shadow(
            &workspace,
            &shadow,
            "src/main.rs",
            raw_patch,
            "fn main() {}\n",
        )
        .unwrap();

        let original = fs::read_to_string(&src_file).unwrap();
        assert_eq!(original, "fn main() {}\n");

        let shadow_content = fs::read_to_string(shadow.join("src").join("main.rs")).unwrap();
        assert!(shadow_content.contains("// patched"));
    }
}
