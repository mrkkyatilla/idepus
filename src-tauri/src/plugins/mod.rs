mod host;

pub use host::PluginHost;

use std::sync::Mutex;

use serde::Serialize;

use crate::error::AppError;

pub struct PluginState {
    pub host: Mutex<PluginHost>,
}

impl PluginState {
    pub fn new() -> Result<Self, AppError> {
        Ok(Self {
            host: Mutex::new(PluginHost::load_all()?),
        })
    }
}

impl Default for PluginState {
    fn default() -> Self {
        Self::new().expect("plugin host")
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ContextSourceSuggestion {
    pub kind: String,
    pub path: String,
    pub label: String,
}

#[tauri::command]
pub fn load_plugins(state: tauri::State<'_, PluginState>) -> Result<usize, AppError> {
    let host = PluginHost::load_all()?;
    let count = host.plugin_count();
    *state.host.lock().expect("plugin lock") = host;
    Ok(count)
}

#[tauri::command]
pub fn list_context_sources(
    state: tauri::State<'_, PluginState>,
    query: String,
    workspace_root: String,
) -> Result<Vec<ContextSourceSuggestion>, AppError> {
    let host = state.host.lock().expect("plugin lock");
    Ok(host
        .suggest(&query, std::path::Path::new(&workspace_root))
        .into_iter()
        .map(|s| ContextSourceSuggestion {
            kind: s.kind,
            path: s.path,
            label: s.label,
        })
        .collect())
}
