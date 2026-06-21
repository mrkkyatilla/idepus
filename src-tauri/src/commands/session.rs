use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_agent_mode: Option<String>,
    #[serde(default)]
    pub chat_messages: Vec<serde_json::Value>,
    #[serde(default)]
    pub patch_queue: Vec<serde_json::Value>,
    pub saved_at: u64,
}

fn config_dir() -> Result<PathBuf, AppError> {
    let home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| AppError::Config("cannot resolve config dir".into()))?;
    Ok(home.join("idepus"))
}

fn session_path() -> Result<PathBuf, AppError> {
    Ok(config_dir()?.join("session.json"))
}

fn write_atomic(path: &PathBuf, data: &str) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Config(e.to_string()))?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).map_err(|e| AppError::Config(e.to_string()))?;
    fs::rename(&tmp, path).map_err(|e| AppError::Config(e.to_string()))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshotV2 {
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_session_id: Option<String>,
    #[serde(default)]
    pub open_session_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_id: Option<String>,
    pub saved_at: u64,
}

#[tauri::command]
pub fn load_session_snapshot_v2() -> Result<Option<SessionSnapshotV2>, AppError> {
    let path = session_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| AppError::Config(e.to_string()))?;
    match serde_json::from_str::<SessionSnapshotV2>(&text) {
        Ok(snapshot) if snapshot.version == 2 => Ok(Some(snapshot)),
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn save_session_snapshot_v2(snapshot: SessionSnapshotV2) -> Result<(), AppError> {
    if snapshot.version != 2 {
        return Err(AppError::Config("unsupported session version".into()));
    }
    let path = session_path()?;
    let data =
        serde_json::to_string_pretty(&snapshot).map_err(|e| AppError::Config(e.to_string()))?;
    write_atomic(&path, &data)
}

#[tauri::command]
pub fn load_session_snapshot() -> Result<Option<SessionSnapshot>, AppError> {
    let path = session_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| AppError::Config(e.to_string()))?;
    match serde_json::from_str::<SessionSnapshot>(&text) {
        Ok(snapshot) if snapshot.version == 1 => Ok(Some(snapshot)),
        Ok(_) => {
            let _ = fs::remove_file(&path);
            Ok(None)
        }
        Err(_) => {
            let _ = fs::remove_file(&path);
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn save_session_snapshot(snapshot: SessionSnapshot) -> Result<(), AppError> {
    if snapshot.version != 1 {
        return Err(AppError::Config("unsupported session version".into()));
    }
    let path = session_path()?;
    let data =
        serde_json::to_string_pretty(&snapshot).map_err(|e| AppError::Config(e.to_string()))?;
    write_atomic(&path, &data)
}

#[tauri::command]
pub fn clear_session_snapshot() -> Result<(), AppError> {
    let path = session_path()?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| AppError::Config(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_snapshot() {
        let snapshot = SessionSnapshot {
            version: 1,
            last_run_id: Some("run-1".into()),
            last_agent_id: Some("multi-file-editor".into()),
            last_agent_mode: Some("agent".into()),
            chat_messages: vec![serde_json::json!({"id":"m1","role":"user","content":"hi"})],
            patch_queue: vec![],
            saved_at: 1,
        };
        let data = serde_json::to_string(&snapshot).unwrap();
        let parsed: SessionSnapshot = serde_json::from_str(&data).unwrap();
        assert_eq!(parsed.last_run_id.as_deref(), Some("run-1"));
    }
}
