use std::sync::Mutex;

use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

use crate::error::AppError;

pub struct SidecarLifecycle {
    child: Mutex<Option<CommandChild>>,
}

impl SidecarLifecycle {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    pub fn stop(&self) {
        if let Some(child) = self.child.lock().expect("sidecar lock").take() {
            let _ = child.kill();
        }
    }
}

impl Default for SidecarLifecycle {
    fn default() -> Self {
        Self::new()
    }
}

pub fn spawn_bundled_sidecar(app: &AppHandle, port: u16) -> Result<(), AppError> {
    let plugin_path = resolve_plugin_path()?;
    let bridge_url = std::env::var("IDEPUS_BRIDGE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:17373".to_string());

    let (_rx, sidecar) = app
        .shell()
        .sidecar("aicery")
        .map_err(|e| AppError::Config(format!("sidecar binary missing: {e}")))?
        .env("PORT", port.to_string())
        .env("PLUGIN_PATHS", plugin_path)
        .env("IDEPUS_BRIDGE_URL", bridge_url)
        .env("API_KEY", std::env::var("API_KEY").unwrap_or_else(|_| "dev".into()))
        .spawn()
        .map_err(|e| AppError::Config(format!("sidecar spawn failed: {e}")))?;

    if let Some(state) = app.try_state::<SidecarLifecycle>() {
        *state.child.lock().expect("sidecar lock") = Some(sidecar);
    }

    Ok(())
}

fn resolve_plugin_path() -> Result<String, AppError> {
    if let Ok(path) = std::env::var("PLUGIN_PATHS") {
        return Ok(path);
    }
    let exe = std::env::current_exe().map_err(|e| AppError::Config(e.to_string()))?;
    if let Some(dir) = exe.parent() {
        let bundled = dir.join("idepus-plugin");
        if bundled.is_dir() {
            return Ok(bundled.to_string_lossy().into_owned());
        }
    }
    Ok("idepus-plugin".into())
}
