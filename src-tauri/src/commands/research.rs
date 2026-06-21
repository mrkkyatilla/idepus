use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::research::config::{
    delete_research_api_key, has_research_api_key, load_research_config,
    research_config_view, save_research_config, store_research_api_key, ResearchConfig,
    ResearchConfigView, ResearchProvider,
};
use crate::research::mock::MockProvider;
use crate::research::provider::WebSearchProvider;
use crate::research::tavily::TavilyProvider;

#[derive(Debug, Deserialize)]
pub struct SaveResearchConfigRequest {
    pub enabled: bool,
    pub provider: ResearchProvider,
    #[serde(default)]
    pub blocked_domains: Vec<String>,
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    #[serde(default = "default_max_parallel")]
    pub max_parallel_runs: u8,
}

fn default_max_parallel() -> u8 {
    3
}

#[tauri::command]
pub fn get_research_config() -> Result<ResearchConfigView, AppError> {
    research_config_view()
}

#[tauri::command]
pub fn save_research_config_cmd(request: SaveResearchConfigRequest) -> Result<(), AppError> {
    let config = ResearchConfig {
        enabled: request.enabled,
        provider: request.provider,
        blocked_domains: request.blocked_domains,
        allowed_domains: request.allowed_domains,
        max_parallel_runs: request.max_parallel_runs.clamp(1, 3),
    };
    save_research_config(&config)
}

#[tauri::command]
pub fn save_research_api_key(api_key: String) -> Result<(), AppError> {
    store_research_api_key(&api_key)
}

#[tauri::command]
pub fn delete_research_api_key_cmd() -> Result<(), AppError> {
    delete_research_api_key()
}

#[derive(Debug, Serialize)]
pub struct ResearchTestResult {
    pub ok: bool,
    pub message: String,
    pub result_count: usize,
}

#[tauri::command]
pub fn test_research_connection() -> Result<ResearchTestResult, AppError> {
    let config = load_research_config()?;
    if !config.enabled {
        return Ok(ResearchTestResult {
            ok: false,
            message: "Web research is disabled".into(),
            result_count: 0,
        });
    }

    let hits = match config.provider {
        ResearchProvider::Mock => MockProvider.search("idepus smoke test", 1)?,
        ResearchProvider::Tavily => {
            if !has_research_api_key() {
                return Ok(ResearchTestResult {
                    ok: false,
                    message: "Tavily API key not configured".into(),
                    result_count: 0,
                });
            }
            let key = crate::research::config::get_research_api_key()?.unwrap_or_default();
            TavilyProvider::new(key).search("idepus smoke test", 1)?
        }
    };

    Ok(ResearchTestResult {
        ok: !hits.is_empty(),
        message: if hits.is_empty() {
            "No results returned".into()
        } else {
            format!("OK — {} result(s)", hits.len())
        },
        result_count: hits.len(),
    })
}

pub fn max_parallel_runs() -> u8 {
    load_research_config()
        .map(|c| c.max_parallel_runs.clamp(1, 3))
        .unwrap_or(3)
}
