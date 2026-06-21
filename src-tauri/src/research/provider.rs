use serde::{Deserialize, Serialize};

use crate::error::AppError;

use super::config::{get_research_api_key, load_research_config, ResearchProvider};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

pub trait WebSearchProvider: Send + Sync {
    fn search(&self, query: &str, max_results: usize) -> Result<Vec<SearchResult>, AppError>;
}

pub fn provider_for_config() -> Result<Box<dyn WebSearchProvider>, AppError> {
    let config = load_research_config()?;
    match config.provider {
        ResearchProvider::Mock => Ok(Box::new(super::mock::MockProvider)),
        ResearchProvider::Tavily => {
            let key = get_research_api_key()?.unwrap_or_default();
            Ok(Box::new(super::tavily::TavilyProvider::new(key)))
        }
    }
}
