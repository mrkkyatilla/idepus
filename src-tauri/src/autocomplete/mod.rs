use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub mod config;
pub mod context;
pub mod mock;
pub mod ollama;

pub use config::{AutocompleteConfig, AutocompleteProvider};

use config::{load_autocomplete_config, save_autocomplete_config};
use mock::mock_suggest;
use ollama::{ollama_health_check, ollama_suggest, rate_limit_sleep, OllamaHealth};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutocompleteRequest {
    pub prefix: String,
    pub suffix: String,
    pub file_path: String,
    pub language: String,
    pub cursor_offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutocompleteSuggestion {
    pub text: String,
    pub model: String,
    pub latency_ms: u32,
}

static RATE_LIMIT: OnceLock<Mutex<Instant>> = OnceLock::new();

fn rate_limit_lock() -> &'static Mutex<Instant> {
    RATE_LIMIT.get_or_init(|| Mutex::new(Instant::now()))
}

pub fn get_config() -> Result<AutocompleteConfig, AppError> {
    load_autocomplete_config()
}

pub fn save_config(config: &AutocompleteConfig) -> Result<(), AppError> {
    save_autocomplete_config(config)
}

pub async fn suggest(
    request: &AutocompleteRequest,
) -> Result<Option<AutocompleteSuggestion>, AppError> {
    let config = load_autocomplete_config()?;
    if !config.enabled {
        return Ok(None);
    }

    if should_ignore_path(&request.file_path) {
        return Ok(None);
    }

    if let Ok(mut last) = rate_limit_lock().lock() {
        rate_limit_sleep(&mut last);
    }

    match config.provider {
        AutocompleteProvider::Mock => Ok(mock_suggest(request)),
        AutocompleteProvider::Ollama => {
            let health = ollama_health_check().await;
            if !health.available {
                return Ok(None);
            }
            ollama_suggest(request, &config.model).await
        }
    }
}

pub async fn health_check() -> OllamaHealth {
    ollama_health_check().await
}

fn should_ignore_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/").to_lowercase();
    if normalized.ends_with(".md")
        || normalized.ends_with(".json")
        || normalized.ends_with(".lock")
    {
        return true;
    }
    for segment in ["node_modules", "dist", "target", ".git", ".idepus"] {
        if normalized.contains(&format!("/{segment}/")) || normalized.starts_with(segment) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_markdown_paths() {
        assert!(should_ignore_path("docs/README.md"));
        assert!(!should_ignore_path("src/main.rs"));
    }

    #[test]
    fn ignores_node_modules() {
        assert!(should_ignore_path("node_modules/foo/index.ts"));
    }
}
