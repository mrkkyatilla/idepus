pub mod config;
pub mod fetch;
pub mod mock;
pub mod provider;
pub mod tavily;

use serde_json::{json, Value};

use crate::bridge::search_stub::truncate_tool_json;
use crate::error::AppError;

use self::config::load_research_config;
use self::provider::provider_for_config;

pub fn tool_web_search(args: &Value) -> Result<Value, AppError> {
    let config = load_research_config()?;
    if !config.enabled {
        return Err(AppError::Workspace("web_research_disabled".into()));
    }

    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Workspace("web_search: missing query".into()))?;
    let max_results = args
        .get("max_results")
        .and_then(|v| v.as_u64())
        .unwrap_or(5) as usize;

    let provider = provider_for_config()?;
    let results = provider.search(query, max_results)?;

    let mut value = json!({ "results": results, "query": query });
    truncate_tool_json(&mut value, 500, 8_000);
    Ok(value)
}

pub fn tool_fetch_url(args: &Value) -> Result<Value, AppError> {
    let url = args
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Workspace("fetch_url: missing url".into()))?;
    fetch::fetch_url(url)
}
