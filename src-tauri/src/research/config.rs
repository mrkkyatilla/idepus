use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

const KEYRING_SERVICE: &str = "idepus";
const TAVILY_KEY_ID: &str = "research-tavily";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResearchProvider {
    Mock,
    Tavily,
}

impl Default for ResearchProvider {
    fn default() -> Self {
        Self::Mock
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub provider: ResearchProvider,
    #[serde(default)]
    pub blocked_domains: Vec<String>,
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    #[serde(default = "default_max_parallel_runs")]
    pub max_parallel_runs: u8,
}

fn default_max_parallel_runs() -> u8 {
    3
}

impl Default for ResearchConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: ResearchProvider::Mock,
            blocked_domains: Vec::new(),
            allowed_domains: Vec::new(),
            max_parallel_runs: 3,
        }
    }
}

fn config_path() -> Result<PathBuf, AppError> {
    let home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| AppError::Config("cannot resolve config dir".into()))?;
    Ok(home.join("idepus").join("research.json"))
}

pub fn load_research_config() -> Result<ResearchConfig, AppError> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(ResearchConfig::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| AppError::Config(e.to_string()))?;
    serde_json::from_str(&raw).map_err(|e| AppError::Config(e.to_string()))
}

pub fn save_research_config(config: &ResearchConfig) -> Result<(), AppError> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Config(e.to_string()))?;
    }
    let raw =
        serde_json::to_string_pretty(config).map_err(|e| AppError::Config(e.to_string()))?;
    fs::write(&path, raw).map_err(|e| AppError::Config(e.to_string()))?;
    Ok(())
}

pub fn store_research_api_key(api_key: &str) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return delete_research_api_key();
    }
    keyring::Entry::new(KEYRING_SERVICE, TAVILY_KEY_ID)
        .map_err(|e| AppError::Config(e.to_string()))?
        .set_password(trimmed)
        .map_err(|e| AppError::Config(format!("keyring store failed: {e}")))
}

pub fn get_research_api_key() -> Result<Option<String>, AppError> {
    match keyring::Entry::new(KEYRING_SERVICE, TAVILY_KEY_ID) {
        Ok(entry) => match entry.get_password() {
            Ok(key) if !key.trim().is_empty() => Ok(Some(key)),
            Ok(_) => Ok(None),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Config(format!("keyring read failed: {e}"))),
        },
        Err(e) => Err(AppError::Config(e.to_string())),
    }
}

pub fn delete_research_api_key() -> Result<(), AppError> {
    match keyring::Entry::new(KEYRING_SERVICE, TAVILY_KEY_ID) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Config(format!("keyring delete failed: {e}"))),
        },
        Err(e) => Err(AppError::Config(e.to_string())),
    }
}

pub fn has_research_api_key() -> bool {
    get_research_api_key()
        .ok()
        .flatten()
        .is_some_and(|k| !k.trim().is_empty())
}

#[derive(Debug, Clone, Serialize)]
pub struct ResearchConfigView {
    pub enabled: bool,
    pub provider: ResearchProvider,
    pub blocked_domains: Vec<String>,
    pub allowed_domains: Vec<String>,
    pub max_parallel_runs: u8,
    pub has_api_key: bool,
}

pub fn research_config_view() -> Result<ResearchConfigView, AppError> {
    let config = load_research_config()?;
    Ok(ResearchConfigView {
        enabled: config.enabled,
        provider: config.provider,
        blocked_domains: config.blocked_domains,
        allowed_domains: config.allowed_domains,
        max_parallel_runs: config.max_parallel_runs,
        has_api_key: has_research_api_key(),
    })
}
