use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryEvent {
    pub name: String,
    pub ts: u64,
    #[serde(default)]
    pub props: Option<serde_json::Value>,
}

fn telemetry_log_path() -> Result<PathBuf, AppError> {
    let home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| AppError::Config("cannot resolve config dir".into()))?;
    Ok(home.join("idepus").join("telemetry.log"))
}

#[tauri::command]
pub fn telemetry_log_event(event: TelemetryEvent) -> Result<(), AppError> {
    let path = telemetry_log_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Config(e.to_string()))?;
    }
    let line = serde_json::to_string(&event).map_err(|e| AppError::Config(e.to_string()))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| AppError::Config(e.to_string()))?;
    writeln!(file, "{line}").map_err(|e| AppError::Config(e.to_string()))?;
    Ok(())
}
