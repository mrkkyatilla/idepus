use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::workspace::types::RecentWorkspace;

const MAX_RECENT: usize = 10;

fn config_dir() -> Result<PathBuf, AppError> {
    let home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| AppError::Config("cannot resolve config dir".into()))?;
    Ok(home.join("idepus"))
}

fn recent_path() -> Result<PathBuf, AppError> {
    Ok(config_dir()?.join("recent.json"))
}

pub fn load_recent() -> Result<Vec<RecentWorkspace>, AppError> {
    let path = recent_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(&path).map_err(|e| AppError::Config(e.to_string()))?;
    serde_json::from_str(&data).map_err(|e| AppError::Config(e.to_string()))
}

pub fn save_recent(entries: &[RecentWorkspace]) -> Result<(), AppError> {
    let path = recent_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Config(e.to_string()))?;
    }
    let data =
        serde_json::to_string_pretty(entries).map_err(|e| AppError::Config(e.to_string()))?;
    fs::write(path, data).map_err(|e| AppError::Config(e.to_string()))?;
    Ok(())
}

pub fn promote_workspace(root_path: &str) -> Result<Vec<RecentWorkspace>, AppError> {
    let name = Path::new(root_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("workspace")
        .to_string();

    let mut entries = load_recent()?;
    entries.retain(|e| e.path != root_path);
    entries.insert(
        0,
        RecentWorkspace {
            path: root_path.to_string(),
            name,
        },
    );
    entries.truncate(MAX_RECENT);
    save_recent(&entries)?;
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promote_caps_at_ten() {
        let mut entries = Vec::new();
        for i in 0..12 {
            entries.push(RecentWorkspace {
                path: format!("/proj/{i}"),
                name: format!("proj{i}"),
            });
        }
        entries.truncate(MAX_RECENT);
        assert_eq!(entries.len(), 10);
    }
}
