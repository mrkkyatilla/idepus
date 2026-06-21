use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const DEFAULT_MODEL: &str = "qwen2.5-coder:1.5b";
const DEFAULT_DEBOUNCE_MS: u32 = 250;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AutocompleteProvider {
    Mock,
    Ollama,
}

impl Default for AutocompleteProvider {
    fn default() -> Self {
        Self::Mock
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutocompleteConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub provider: AutocompleteProvider,
    #[serde(default = "default_debounce_ms")]
    pub debounce_ms: u32,
    #[serde(default = "default_model")]
    pub model: String,
}

fn default_debounce_ms() -> u32 {
    DEFAULT_DEBOUNCE_MS
}

fn default_model() -> String {
    DEFAULT_MODEL.to_string()
}

impl Default for AutocompleteConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: AutocompleteProvider::Mock,
            debounce_ms: DEFAULT_DEBOUNCE_MS,
            model: DEFAULT_MODEL.to_string(),
        }
    }
}

fn config_path() -> Result<PathBuf, AppError> {
    let home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| AppError::Config("cannot resolve config dir".into()))?;
    Ok(home.join("idepus").join("autocomplete.json"))
}

pub fn load_autocomplete_config() -> Result<AutocompleteConfig, AppError> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AutocompleteConfig::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| AppError::Config(e.to_string()))?;
    serde_json::from_str(&raw).map_err(|e| AppError::Config(e.to_string()))
}

pub fn save_autocomplete_config(config: &AutocompleteConfig) -> Result<(), AppError> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Config(e.to_string()))?;
    }
    let raw =
        serde_json::to_string_pretty(config).map_err(|e| AppError::Config(e.to_string()))?;
    fs::write(&path, raw).map_err(|e| AppError::Config(e.to_string()))?;
    Ok(())
}
