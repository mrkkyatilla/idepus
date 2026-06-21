use std::path::{Path, PathBuf};
use std::process::Command;

use ignore::gitignore::Gitignore;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::workspace::ignore::is_ignored;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepHit {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub text: String,
}

pub fn grep_workspace(
    workspace_root: &Path,
    matcher: &Gitignore,
    pattern: &str,
    subpath: Option<&str>,
    glob: Option<&str>,
    max_hits: usize,
) -> Result<Vec<GrepHit>, AppError> {
    let search_root = if let Some(p) = subpath {
        let resolved = workspace_root.join(p);
        if !resolved.starts_with(workspace_root) {
            return Err(AppError::Workspace("grep path escapes workspace".into()));
        }
        resolved
    } else {
        workspace_root.to_path_buf()
    };

    if !search_root.exists() {
        return Ok(vec![]);
    }

    if let Some(hits) = try_ripgrep(
        workspace_root,
        &search_root,
        pattern,
        glob,
        max_hits,
    )? {
        return Ok(hits);
    }

    regex_walk_grep(
        workspace_root,
        matcher,
        &search_root,
        pattern,
        max_hits,
    )
}

fn try_ripgrep(
    workspace_root: &Path,
    search_root: &Path,
    pattern: &str,
    glob: Option<&str>,
    max_hits: usize,
) -> Result<Option<Vec<GrepHit>>, AppError> {
    let rg = match which_rg() {
        Some(p) => p,
        None => return Ok(None),
    };

    let mut cmd = Command::new(rg);
    cmd.arg("--json")
        .arg("--line-number")
        .arg("--column")
        .arg("--max-count")
        .arg(max_hits.to_string())
        .arg("--glob")
        .arg("!.git/*")
        .arg("--glob")
        .arg("!node_modules/*")
        .arg("--glob")
        .arg("!target/*")
        .arg("--glob")
        .arg("!.idepus/*");

    if let Some(g) = glob {
        cmd.arg("--glob").arg(g);
    }

    cmd.arg(pattern).arg(search_root);

    let output = cmd
        .output()
        .map_err(|e| AppError::Io(format!("rg failed: {e}")))?;

    if !output.status.success() && !output.stdout.is_empty() {
        // rg exits 1 when no matches
        if output.status.code() != Some(1) {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Workspace(format!("rg error: {stderr}")));
        }
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut hits = Vec::new();

    for line in stdout.lines() {
        if hits.len() >= max_hits {
            break;
        }
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if val.get("type").and_then(|t| t.as_str()) != Some("match") {
            continue;
        }
        let data = val.get("data").unwrap_or(&val);
        let path = data
            .get("path")
            .and_then(|p| p.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("");
        let rel = strip_workspace_prefix(workspace_root, Path::new(path));
        let line_num = data.get("line_number").and_then(|n| n.as_u64()).unwrap_or(0) as u32;
        let column = data
            .get("submatches")
            .and_then(|s| s.as_array())
            .and_then(|a| a.first())
            .and_then(|m| m.get("start"))
            .and_then(|s| s.as_u64())
            .map(|c| c as u32 + 1)
            .unwrap_or(1);
        let text = data
            .get("lines")
            .and_then(|l| l.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .trim_end()
            .to_string();

        hits.push(GrepHit {
            path: rel,
            line: line_num,
            column,
            text,
        });
    }

    Ok(Some(hits))
}

fn which_rg() -> Option<PathBuf> {
    Command::new("rg")
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|_| PathBuf::from("rg"))
}

fn regex_walk_grep(
    workspace_root: &Path,
    matcher: &Gitignore,
    search_root: &Path,
    pattern: &str,
    max_hits: usize,
) -> Result<Vec<GrepHit>, AppError> {
    let re = Regex::new(pattern)
        .map_err(|e| AppError::Workspace(format!("invalid grep pattern: {e}")))?;
    let mut hits = Vec::new();
    walk_grep(
        workspace_root,
        matcher,
        search_root,
        &re,
        &mut hits,
        max_hits,
    )?;
    Ok(hits)
}

fn walk_grep(
    workspace_root: &Path,
    matcher: &Gitignore,
    dir: &Path,
    re: &Regex,
    hits: &mut Vec<GrepHit>,
    max_hits: usize,
) -> Result<(), AppError> {
    if hits.len() >= max_hits {
        return Ok(());
    }

    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return Ok(()),
    };

    for entry in read_dir.flatten() {
        if hits.len() >= max_hits {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".env" {
            continue;
        }
        let rel = path.strip_prefix(workspace_root).unwrap_or(&path);
        if is_ignored(matcher, rel, path.is_dir()) {
            continue;
        }
        if path.is_dir() {
            walk_grep(workspace_root, matcher, &path, re, hits, max_hits)?;
        } else if path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                for (idx, line) in content.lines().enumerate() {
                    if let Some(m) = re.find(line) {
                        hits.push(GrepHit {
                            path: rel.to_string_lossy().to_string(),
                            line: (idx + 1) as u32,
                            column: (m.start() + 1) as u32,
                            text: line.to_string(),
                        });
                        if hits.len() >= max_hits {
                            break;
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn strip_workspace_prefix(workspace_root: &Path, path: &Path) -> String {
    path.strip_prefix(workspace_root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::ignore::build_gitignore;
    use std::fs;

    #[test]
    fn regex_fallback_finds_pattern() {
        let dir = std::env::temp_dir().join("idepus-grep-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/auth.rs"), "fn login_user() {}\n").unwrap();
        let matcher = build_gitignore(&dir).unwrap();
        let hits = regex_walk_grep(&dir, &matcher, &dir, "login_user", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "src/auth.rs");
        let _ = fs::remove_dir_all(&dir);
    }
}
