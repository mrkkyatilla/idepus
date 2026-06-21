use std::time::{Duration, Instant};

use reqwest::Client;
use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
pub struct SidecarHealth {
    pub ok: bool,
    pub url: String,
    pub agents: Vec<String>,
    pub message: String,
    pub elapsed_ms: u64,
}

pub async fn poll_health(url: &str, api_key: &str) -> Result<SidecarHealth, AppError> {
    let base = url.trim_end_matches('/');
    let started = Instant::now();
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| AppError::Config(e.to_string()))?;

    let response = client
        .get(format!("{base}/v1/agents"))
        .header("X-API-Key", api_key)
        .send()
        .await
        .map_err(|e| AppError::Config(format!("sidecar unreachable: {e}")))?;

    let elapsed_ms = started.elapsed().as_millis() as u64;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Ok(SidecarHealth {
            ok: false,
            url: base.to_string(),
            agents: vec![],
            message: format!("HTTP error: {text}"),
            elapsed_ms,
        });
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AppError::Config(e.to_string()))?;

    let agents = body
        .get("agents")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    item.get("id")
                        .or_else(|| item.get("agent_id"))
                        .and_then(|id| id.as_str())
                        .map(str::to_string)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(SidecarHealth {
        ok: true,
        url: base.to_string(),
        agents,
        message: "sidecar healthy".into(),
        elapsed_ms,
    })
}
