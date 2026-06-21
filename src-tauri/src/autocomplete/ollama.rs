use std::sync::OnceLock;
use std::time::{Duration, Instant};

use idepus_llm::OllamaAutocomplete;
use serde::Serialize;

use crate::error::AppError;

use super::context::lite_context;
use super::{AutocompleteRequest, AutocompleteSuggestion};

static OLLAMA: OnceLock<OllamaAutocomplete> = OnceLock::new();

fn ollama_client() -> &'static OllamaAutocomplete {
    OLLAMA.get_or_init(|| OllamaAutocomplete::new(None))
}

#[derive(Debug, Serialize)]
pub struct OllamaHealth {
    pub available: bool,
    pub models: Vec<String>,
    pub gpu_detected: bool,
    pub message: String,
}

pub async fn ollama_health_check() -> OllamaHealth {
    match ollama_client().list_models().await {
        Ok(models) => {
            let gpu = gpu_hint();
            OllamaHealth {
                available: true,
                models: models.clone(),
                gpu_detected: gpu,
                message: if gpu {
                    "Ollama is running (GPU hint detected)".into()
                } else {
                    "Ollama is running — qwen2.5-coder:1.5b recommended without GPU".into()
                },
            }
        }
        Err(err) => OllamaHealth {
            available: false,
            models: Vec::new(),
            gpu_detected: false,
            message: format!("Ollama unavailable: {err}"),
        },
    }
}

pub async fn ollama_suggest(
    request: &AutocompleteRequest,
    model: &str,
) -> Result<Option<AutocompleteSuggestion>, AppError> {
    let start = Instant::now();
    let (prefix, suffix) =
        lite_context(&request.prefix, &request.suffix, request.cursor_offset);
    let text = ollama_client()
        .fill_in_middle(&prefix, &suffix, model, 96)
        .await
        .map_err(|e| AppError::Llm(e.to_string()))?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Ok(None);
    }
    Ok(Some(AutocompleteSuggestion {
        text: trimmed,
        model: format!("ollama:{model}"),
        latency_ms: start.elapsed().as_millis().min(u128::from(u32::MAX)) as u32,
    }))
}

pub async fn ollama_pull_model(model: &str) -> Result<String, AppError> {
    ollama_client()
        .pull_model(model)
        .await
        .map_err(|e| AppError::Config(e.to_string()))
}

fn gpu_hint() -> bool {
    std::env::var("IDEpus_GPU")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or_else(|_| {
            std::process::Command::new("nvidia-smi")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        })
}

pub fn rate_limit_sleep(last: &mut Instant) {
    let min_gap = Duration::from_millis(50);
    let elapsed = last.elapsed();
    if elapsed < min_gap {
        std::thread::sleep(min_gap - elapsed);
    }
    *last = Instant::now();
}
