use std::fs;
use std::path::PathBuf;

use idepus_llm::credentials::get_api_key;
use idepus_llm::{ProviderConfig, ProviderInfo};
use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::llm::{
    bridge::LlmState, cancel_stream as registry_cancel, registry_from_state, spawn_stream,
    StreamRequestV2,
};

fn idepus_config_dir() -> Result<PathBuf, AppError> {
    let home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| AppError::Config("cannot resolve config dir".into()))?;
    Ok(home.join("idepus"))
}

fn env_line(key: &str, value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("{key}=\"{escaped}\"")
}

#[derive(Debug, serde::Serialize)]
pub struct AiceryProviderSyncResult {
    pub wrote_file: bool,
    pub path: String,
    pub needs_aicery_reload: bool,
}

#[tauri::command]
pub async fn llm_complete_stream(
    app: AppHandle,
    request: StreamRequestV2,
) -> Result<(), AppError> {
    spawn_stream(app, request)
}

#[tauri::command]
pub async fn cancel_stream(app: AppHandle, request_id: String) -> Result<(), AppError> {
    registry_cancel(&app, &request_id);
    Ok(())
}

#[tauri::command]
pub fn get_providers(state: State<LlmState>) -> Result<Vec<ProviderInfo>, AppError> {
    let guard = registry_from_state(&state)?;
    Ok(guard.list_providers())
}

#[derive(Debug, Deserialize)]
pub struct SetActiveProviderRequest {
    pub provider_id: String,
    pub model: Option<String>,
    pub api_key: Option<String>,
}

#[tauri::command]
pub fn set_active_provider(
    state: State<LlmState>,
    config: SetActiveProviderRequest,
) -> Result<ProviderConfig, AppError> {
    let guard = registry_from_state(&state)?;
    guard
        .set_active_provider(&config.provider_id, config.model, config.api_key)
        .map_err(|e| AppError::Config(e.to_string()))
}

#[tauri::command]
pub fn get_active_provider(state: State<LlmState>) -> Result<ProviderConfig, AppError> {
    let guard = registry_from_state(&state)?;
    Ok(guard.get_active_config())
}

#[tauri::command]
pub fn sync_aicery_provider_env(
    state: State<LlmState>,
) -> Result<AiceryProviderSyncResult, AppError> {
    let guard = registry_from_state(&state)?;
    let active = guard.get_active_config();

    let mut lines: Vec<String> = Vec::new();
    if let Ok(Some(key)) = get_api_key("openai") {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            lines.push(env_line("OPENAI_API_KEY", trimmed));
        }
    }
    if let Ok(Some(key)) = get_api_key("anthropic") {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            lines.push(env_line("ANTHROPIC_API_KEY", trimmed));
        }
    }

    let dir = idepus_config_dir()?;
    fs::create_dir_all(&dir).map_err(|e| AppError::Config(e.to_string()))?;
    let path = dir.join("aicery-provider.env");

    if lines.is_empty() {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| AppError::Config(e.to_string()))?;
        }
        return Ok(AiceryProviderSyncResult {
            wrote_file: false,
            path: path.display().to_string(),
            needs_aicery_reload: false,
        });
    }

    lines.push("USE_MOCK_PROVIDER=false".into());
    lines.push(env_line(
        "OPENAI_MODEL",
        if active.provider_id == "openai" {
            active.model.as_str()
        } else {
            "gpt-4o-mini"
        },
    ));
    lines.push(env_line(
        "ANTHROPIC_MODEL",
        if active.provider_id == "anthropic" {
            active.model.as_str()
        } else {
            "claude-3-5-haiku-20241022"
        },
    ));

    fs::write(&path, format!("{}\n", lines.join("\n")))
        .map_err(|e| AppError::Config(e.to_string()))?;

    Ok(AiceryProviderSyncResult {
        wrote_file: true,
        path: path.display().to_string(),
        needs_aicery_reload: true,
    })
}

#[tauri::command]
pub async fn test_llm_connection(state: State<'_, LlmState>) -> Result<(), AppError> {
    let (provider, options) = {
        let guard = registry_from_state(&state)?;
        (
            guard
                .active_provider()
                .map_err(|e| AppError::Llm(e.to_string()))?,
            guard.active_generate_options(),
        )
    };
    provider
        .test_connection(&options)
        .await
        .map_err(|e| AppError::Llm(e.to_string()))
}
