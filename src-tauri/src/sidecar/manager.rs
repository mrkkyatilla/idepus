use std::time::Duration;

use tauri::AppHandle;
use tauri::Manager;

use crate::error::AppError;
use crate::sidecar::health::{poll_health, SidecarHealth};
use crate::sidecar::lifecycle::{spawn_bundled_sidecar, SidecarLifecycle};

const DEFAULT_PORT: u16 = 8000;
const DEFAULT_URL: &str = "http://127.0.0.1:8000";

pub struct SidecarManager {
    port: u16,
    url: String,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            port: DEFAULT_PORT,
            url: DEFAULT_URL.to_string(),
        }
    }

    #[allow(dead_code)]
    pub fn runtime_url(&self) -> &str {
        &self.url
    }

    pub async fn ensure_running(&self, app: &AppHandle) -> Result<SidecarHealth, AppError> {
        if cfg!(debug_assertions) {
            return poll_health(&self.url, "dev").await;
        }

        if let Ok(health) = poll_health(&self.url, "dev").await {
            if health.ok {
                return Ok(health);
            }
        }

        spawn_bundled_sidecar(app, self.port)?;

        for _ in 0..30 {
            tokio::time::sleep(Duration::from_millis(200)).await;
            if let Ok(health) = poll_health(&self.url, "dev").await {
                if health.ok {
                    return Ok(health);
                }
            }
        }

        Err(AppError::Config(
            "bundled Aicery sidecar failed to become healthy".into(),
        ))
    }
}

impl Default for SidecarManager {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn sidecar_start(app: AppHandle) -> Result<SidecarHealth, AppError> {
    let manager = app.state::<SidecarManager>();
    manager.ensure_running(&app).await
}

#[tauri::command]
pub fn sidecar_stop(app: AppHandle) -> Result<(), AppError> {
    if let Some(lifecycle) = app.try_state::<SidecarLifecycle>() {
        lifecycle.stop();
    }
    Ok(())
}

#[tauri::command]
pub async fn sidecar_status(
    runtime_url: Option<String>,
    api_key: Option<String>,
) -> Result<SidecarHealth, AppError> {
    let url = runtime_url.unwrap_or_else(|| DEFAULT_URL.to_string());
    let key = api_key.unwrap_or_else(|| "dev".into());
    poll_health(&url, &key).await
}
