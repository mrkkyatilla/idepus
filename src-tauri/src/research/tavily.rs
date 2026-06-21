use reqwest::blocking::Client;
use serde_json::json;

use super::provider::{SearchResult, WebSearchProvider};
use crate::error::AppError;

const TAVILY_URL: &str = "https://api.tavily.com/search";

pub struct TavilyProvider {
    api_key: String,
}

impl TavilyProvider {
    pub fn new(api_key: String) -> Self {
        Self { api_key }
    }
}

impl WebSearchProvider for TavilyProvider {
    fn search(&self, query: &str, max_results: usize) -> Result<Vec<SearchResult>, AppError> {
        if self.api_key.trim().is_empty() {
            return Err(AppError::Workspace(
                "Tavily API key not configured".into(),
            ));
        }

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| AppError::Config(e.to_string()))?;

        let max = max_results.max(1).min(5);
        let body = json!({
            "api_key": self.api_key,
            "query": query,
            "max_results": max,
            "include_answer": false,
        });

        let response = client
            .post(TAVILY_URL)
            .json(&body)
            .send()
            .map_err(|e| AppError::Workspace(format!("Tavily request failed: {e}")))?;

        if !response.status().is_success() {
            let text = response.text().unwrap_or_default();
            return Err(AppError::Workspace(format!("Tavily HTTP error: {text}")));
        }

        let payload: serde_json::Value = response
            .json()
            .map_err(|e| AppError::Workspace(e.to_string()))?;

        let results = payload
            .get("results")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        Some(SearchResult {
                            title: item
                                .get("title")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Untitled")
                                .to_string(),
                            url: item.get("url").and_then(|v| v.as_str())?.to_string(),
                            snippet: item
                                .get("content")
                                .or_else(|| item.get("snippet"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .chars()
                                .take(500)
                                .collect(),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        Ok(results)
    }
}
