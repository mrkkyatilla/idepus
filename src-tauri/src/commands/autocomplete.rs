use serde::Deserialize;

use crate::autocomplete::{
    self, AutocompleteConfig, AutocompleteProvider, AutocompleteRequest, AutocompleteSuggestion,
};
use crate::autocomplete::ollama::OllamaHealth;
use crate::error::AppError;

#[derive(Debug, Deserialize)]
pub struct SaveAutocompleteConfigRequest {
    pub enabled: bool,
    pub provider: AutocompleteProvider,
    #[serde(default)]
    pub debounce_ms: Option<u32>,
    #[serde(default)]
    pub model: Option<String>,
}

#[tauri::command]
pub fn get_autocomplete_config() -> Result<AutocompleteConfig, AppError> {
    autocomplete::get_config()
}

#[tauri::command]
pub fn save_autocomplete_config_cmd(
    request: SaveAutocompleteConfigRequest,
) -> Result<(), AppError> {
    let mut config = autocomplete::get_config()?;
    config.enabled = request.enabled;
    config.provider = request.provider;
    if let Some(ms) = request.debounce_ms {
        config.debounce_ms = ms.clamp(200, 500);
    }
    if let Some(model) = request.model {
        if !model.trim().is_empty() {
            config.model = model.trim().to_string();
        }
    }
    autocomplete::save_config(&config)
}

#[tauri::command]
pub async fn autocomplete_suggest(
    request: AutocompleteRequest,
) -> Result<Option<AutocompleteSuggestion>, AppError> {
    autocomplete::suggest(&request).await
}

#[tauri::command]
pub async fn ollama_health_check() -> Result<OllamaHealth, AppError> {
    Ok(autocomplete::health_check().await)
}

#[tauri::command]
pub async fn ollama_pull_model(model: String) -> Result<String, AppError> {
    autocomplete::ollama::ollama_pull_model(&model).await
}
