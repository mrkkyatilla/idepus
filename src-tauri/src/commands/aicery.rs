use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use tauri::State;

use crate::error::AppError;
use crate::llm::{bridge::LlmState, registry_from_state};

fn stream_cancels() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static MAP: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancel_flag(run_id: &str) -> Arc<AtomicBool> {
    let mut map = stream_cancels().lock().expect("stream cancel lock");
    map.entry(run_id.to_string())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone()
}

fn clear_cancel_flag(run_id: &str) {
    let mut map = stream_cancels().lock().expect("stream cancel lock");
    map.remove(run_id);
}

#[derive(Debug, Clone, Serialize)]
pub struct AicerySidecarStatus {
    pub ok: bool,
    pub url: String,
    pub agents: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiceryRun {
    pub id: String,
    pub status: String,
    pub agent_id: String,
    pub input_text: Option<String>,
    pub output_text: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AicerySsePayload {
    pub run_id: String,
    pub event: String,
    pub data: Value,
}

fn http_client() -> Result<Client, AppError> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::Config(e.to_string()))
}

fn base_url(runtime_url: &str) -> String {
    runtime_url.trim_end_matches('/').to_string()
}

fn map_run(body: &Value) -> Result<AiceryRun, AppError> {
    Ok(AiceryRun {
        id: body
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Config("run response missing id".into()))?
            .to_string(),
        status: body
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        agent_id: body
            .get("agent_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        input_text: body
            .get("input_text")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        output_text: body
            .get("output_text")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        error_code: body
            .get("error_code")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        error_message: body
            .get("error_message")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    })
}

#[tauri::command]
pub async fn aicery_sidecar_status(
    runtime_url: String,
    api_key: String,
) -> Result<AicerySidecarStatus, AppError> {
    let base = base_url(&runtime_url);
    let client = http_client()?;

    let response = client
        .get(format!("{base}/v1/agents"))
        .header("X-API-Key", api_key)
        .send()
        .await
        .map_err(|e| AppError::Config(format!("sidecar unreachable: {e}")))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Ok(AicerySidecarStatus {
            ok: false,
            url: base,
            agents: vec![],
            message: format!("HTTP error: {text}"),
        });
    }

    let body: Value = response
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

    Ok(AicerySidecarStatus {
        ok: true,
        url: base,
        agents,
        message: "Aicery sidecar is healthy".into(),
    })
}

#[tauri::command]
pub async fn aicery_create_run(
    llm: State<'_, LlmState>,
    runtime_url: String,
    api_key: String,
    agent_id: String,
    input: String,
    workspace_id: Option<String>,
    host_workspace_root: Option<String>,
) -> Result<AiceryRun, AppError> {
    let base = base_url(&runtime_url);
    let client = http_client()?;

    let mut payload = json!({
        "agent_id": agent_id,
        "input": input,
        "execute": true,
    });
    if let Ok(guard) = registry_from_state(&llm) {
        let active = guard.get_active_config();
        if active.has_api_key {
            payload["provider_policy"] = json!({
                "llm": {
                    "provider": active.provider_id,
                    "model": active.model,
                }
            });
        }
    }
    if let Some(workspace_id) = workspace_id {
        payload["workspace_id"] = json!(workspace_id);
    }
    if let Some(host_workspace_root) = host_workspace_root {
        payload["host_workspace_root"] = json!(host_workspace_root);
    }

    let response = client
        .post(format!("{base}/v1/runs"))
        .header("X-API-Key", api_key)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::Config(format!("createRun failed: {e}")))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(AppError::Config(format!("createRun HTTP error: {text}")));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| AppError::Config(e.to_string()))?;
    map_run(&body)
}

#[tauri::command]
pub async fn aicery_get_run(
    runtime_url: String,
    api_key: String,
    run_id: String,
) -> Result<AiceryRun, AppError> {
    let base = base_url(&runtime_url);
    let client = http_client()?;

    let response = client
        .get(format!("{base}/v1/runs/{run_id}"))
        .header("X-API-Key", api_key)
        .send()
        .await
        .map_err(|e| AppError::Config(format!("getRun failed: {e}")))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(AppError::Config(format!("getRun HTTP error: {text}")));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| AppError::Config(e.to_string()))?;
    map_run(&body)
}

#[tauri::command]
pub async fn aicery_resume_run(
    runtime_url: String,
    api_key: String,
    run_id: String,
    decision: String,
    approval_id: Option<String>,
    tool_arguments: Option<Value>,
) -> Result<AiceryRun, AppError> {
    let base = base_url(&runtime_url);
    let client = http_client()?;

    let mut payload = json!({ "decision": decision });
    if let Some(approval_id) = approval_id {
        payload["approval_id"] = json!(approval_id);
    }
    if let Some(tool_arguments) = tool_arguments {
        payload["arguments"] = tool_arguments;
    }

    let response = client
        .post(format!("{base}/v1/runs/{run_id}/resume"))
        .header("X-API-Key", api_key)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::Config(format!("resumeRun failed: {e}")))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(AppError::Config(format!("resumeRun HTTP error: {text}")));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| AppError::Config(e.to_string()))?;
    map_run(&body)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiceryRouteResponse {
    pub agent_id: String,
    pub provider: Option<String>,
    pub tier: Option<String>,
}

#[tauri::command]
pub async fn aicery_route(
    runtime_url: String,
    api_key: String,
    input: String,
    workspace_id: Option<String>,
) -> Result<AiceryRouteResponse, AppError> {
    let base = base_url(&runtime_url);
    let client = http_client()?;

    let mut payload = json!({ "input": input });
    if let Some(workspace_id) = workspace_id {
        payload["workspace_id"] = json!(workspace_id);
    }

    let response = client
        .post(format!("{base}/v1/route"))
        .header("X-API-Key", api_key)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await;

    match response {
        Ok(resp) if resp.status().is_success() => {
            let body: Value = resp
                .json()
                .await
                .map_err(|e| AppError::Config(e.to_string()))?;
            Ok(AiceryRouteResponse {
                agent_id: body
                    .get("agent_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("multi-file-editor")
                    .to_string(),
                provider: body
                    .get("provider")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                tier: body
                    .get("tier")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            })
        }
        _ => Ok(AiceryRouteResponse {
            agent_id: "multi-file-editor".into(),
            provider: None,
            tier: None,
        }),
    }
}

#[tauri::command]
pub async fn aicery_stream_run(
    app: AppHandle,
    runtime_url: String,
    api_key: String,
    run_id: String,
) -> Result<(), AppError> {
    let cancel = cancel_flag(&run_id);
    cancel.store(false, Ordering::SeqCst);
    let base = base_url(&runtime_url);

    tauri::async_runtime::spawn(async move {
        if let Err(err) = stream_run_inner(app.clone(), &base, &api_key, &run_id, cancel.clone()).await {
            eprintln!("aicery stream error: {err}");
            let payload = AicerySsePayload {
                run_id: run_id.clone(),
                event: "error".into(),
                data: json!({ "message": err.to_string() }),
            };
            let app_for_emit = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = app_for_emit.emit("aicery_sse_event", payload);
            });
        }
        clear_cancel_flag(&run_id);
    });

    Ok(())
}

#[tauri::command]
pub fn aicery_cancel_stream() {
    let map = stream_cancels().lock().expect("stream cancel lock");
    for flag in map.values() {
        flag.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn aicery_cancel_run(run_id: String) {
    let flag = cancel_flag(&run_id);
    flag.store(true, Ordering::SeqCst);
}

async fn stream_run_inner(
    app: AppHandle,
    base: &str,
    api_key: &str,
    run_id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), AppError> {
    let client = http_client()?;
    let response = client
        .get(format!("{base}/v1/runs/{run_id}/stream"))
        .header("X-API-Key", api_key)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .map_err(|e| AppError::Config(format!("streamRun failed: {e}")))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(AppError::Config(format!("streamRun HTTP error: {text}")));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut event_name: Option<String> = None;
    let mut data_lines: Vec<String> = Vec::new();

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let chunk = chunk.map_err(|e| AppError::Config(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim_end_matches('\r').to_string();
            buffer = buffer[pos + 1..].to_string();

            if line.is_empty() {
                if let (Some(name), false) = (event_name.take(), data_lines.is_empty()) {
                    let raw = data_lines.join("\n");
                    data_lines.clear();
                    let data: Value = serde_json::from_str(&raw).unwrap_or(json!({ "raw": raw }));
                    let payload = AicerySsePayload {
                        run_id: run_id.to_string(),
                        event: name,
                        data,
                    };
                    let app_emit = app.clone();
                    app.run_on_main_thread(move || {
                        let _ = app_emit.emit("aicery_sse_event", payload);
                    })
                    .map_err(|e| AppError::Config(e.to_string()))?;
                } else {
                    data_lines.clear();
                }
                continue;
            }

            if let Some(rest) = line.strip_prefix("event:") {
                event_name = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("data:") {
                data_lines.push(rest.trim().to_string());
            }
        }
    }

    Ok(())
}
