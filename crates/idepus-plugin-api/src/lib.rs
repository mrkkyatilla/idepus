use std::ffi::{c_char, CStr};
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MentionSuggestion {
    pub kind: String,
    pub path: String,
    pub label: String,
}

#[derive(Debug, thiserror::Error)]
pub enum PluginError {
    #[error("plugin error: {0}")]
    Message(String),
}

pub trait AgentTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn execute(&self, input: serde_json::Value) -> Result<serde_json::Value, PluginError>;
}

pub trait ContextSource: Send + Sync {
    fn id(&self) -> &str;
    fn suggest(&self, query: &str, workspace_root: &Path) -> Vec<MentionSuggestion>;
}

#[repr(C)]
pub struct PluginManifest {
    pub api_version: u32,
    pub plugin_name: *const c_char,
    pub context_source_count: usize,
    pub agent_tool_count: usize,
}

/// Read a NUL-terminated C string.
///
/// # Safety
///
/// `ptr` must be a valid pointer to a NUL-terminated UTF-8 string for the duration of the call.
pub unsafe fn cstr_to_string(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    CStr::from_ptr(ptr).to_str().ok().map(str::to_string)
}

/// Plugins export `idepus_plugin_entry() -> PluginManifest` and register hooks via host callbacks.
pub type PluginEntryFn = unsafe extern "C" fn() -> PluginManifest;
