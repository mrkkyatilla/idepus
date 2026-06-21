use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use serde::Serialize;
use tauri::AppHandle;
use std::sync::Mutex;

use crate::bridge::executor::{execute_tool, ToolRequest};

pub const BRIDGE_PORT: u16 = 17373;

#[derive(Clone)]
pub struct BridgeState {
    pub token: String,
    pub port: u16,
}

impl BridgeState {
    pub fn new() -> Self {
        let token = std::env::var("IDEPUS_BRIDGE_TOKEN").unwrap_or_else(|_| {
            #[cfg(debug_assertions)]
            {
                "idepus-dev-bridge".to_string()
            }
            #[cfg(not(debug_assertions))]
            {
                uuid::Uuid::new_v4().to_string()
            }
        });
        Self {
            token,
            port: BRIDGE_PORT,
        }
    }

    pub fn info(&self) -> BridgeInfo {
        BridgeInfo {
            url: format!("http://127.0.0.1:{}", self.port),
            token: self.token.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BridgeInfo {
    pub url: String,
    pub token: String,
}

#[derive(Debug, Serialize)]
struct ToolResponse {
    ok: bool,
    result: Option<serde_json::Value>,
    error: Option<String>,
}

pub async fn start_server(_app: AppHandle, state: BridgeState) {
    let shared = Arc::new(state);
    let app = Router::new()
        .route("/v1/tools/{tool_name}", post(handle_tool))
        .with_state(shared);

    let addr = SocketAddr::from(([0, 0, 0, 0], BRIDGE_PORT));
    #[cfg(not(debug_assertions))]
    {
        addr = SocketAddr::from(([127, 0, 0, 1], BRIDGE_PORT));
    }
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(err) => {
            eprintln!("tool bridge bind failed: {err}");
            return;
        }
    };
    if let Err(err) = axum::serve(listener, app).await {
        eprintln!("tool bridge server error: {err}");
    }
}

async fn handle_tool(
    State(state): State<Arc<BridgeState>>,
    headers: HeaderMap,
    AxumPath(tool_name): AxumPath<String>,
    Json(request): Json<ToolRequest>,
) -> (StatusCode, Json<ToolResponse>) {
    let token = headers
        .get("x-bridge-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if token != state.token {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ToolResponse {
                ok: false,
                result: None,
                error: Some("invalid bridge token".into()),
            }),
        );
    }

    match execute_tool(&tool_name, request) {
        Ok(result) => (
            StatusCode::OK,
            Json(ToolResponse {
                ok: true,
                result: Some(result),
                error: None,
            }),
        ),
        Err(err) => (
            StatusCode::BAD_REQUEST,
            Json(ToolResponse {
                ok: false,
                result: None,
                error: Some(err.to_string()),
            }),
        ),
    }
}

#[tauri::command]
pub fn get_bridge_info(state: tauri::State<'_, Mutex<BridgeState>>) -> BridgeInfo {
    state.lock().expect("bridge lock").info()
}
