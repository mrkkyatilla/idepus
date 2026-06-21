#![allow(clippy::missing_safety_doc)]

use std::ffi::CString;
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

use idepus_plugin_api::{ContextSource, MentionSuggestion, PluginManifest};

struct GitignoreSource;

impl ContextSource for GitignoreSource {
    fn id(&self) -> &str {
        "gitignore"
    }

    fn suggest(&self, query: &str, workspace_root: &Path) -> Vec<MentionSuggestion> {
        let q = query.to_lowercase();
        if !q.is_empty() && !"gitignore".starts_with(&q) {
            return vec![];
        }
        let path = workspace_root.join(".gitignore");
        let mut labels = vec![MentionSuggestion {
            kind: "gitignore".into(),
            path: ".gitignore".into(),
            label: "@gitignore".into(),
        }];
        if let Ok(text) = fs::read_to_string(&path) {
            for line in text.lines().take(20) {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if !q.is_empty() && !trimmed.to_lowercase().contains(&q) {
                    continue;
                }
                labels.push(MentionSuggestion {
                    kind: "gitignore".into(),
                    path: trimmed.into(),
                    label: format!("@gitignore {trimmed}"),
                });
            }
        }
        labels
    }
}

static SOURCE: OnceLock<GitignoreSource> = OnceLock::new();

fn source() -> &'static GitignoreSource {
    SOURCE.get_or_init(|| GitignoreSource)
}

#[no_mangle]
pub extern "C" fn idepus_plugin_entry() -> PluginManifest {
    let name = CString::new("idepus-plugin-gitignore").expect("plugin name");
    PluginManifest {
        api_version: 1,
        plugin_name: name.as_ptr(),
        context_source_count: 1,
        agent_tool_count: 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn idepus_plugin_suggest(
    query_ptr: *const std::os::raw::c_char,
    workspace_ptr: *const std::os::raw::c_char,
) -> *mut std::os::raw::c_char {
    let query = unsafe { idepus_plugin_api::cstr_to_string(query_ptr) }.unwrap_or_default();
    let workspace = unsafe { idepus_plugin_api::cstr_to_string(workspace_ptr) }.unwrap_or_default();
    let suggestions = source().suggest(&query, Path::new(&workspace));
    let json = serde_json::to_string(&suggestions).unwrap_or_else(|_| "[]".into());
    CString::new(json).ok().map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub unsafe extern "C" fn idepus_plugin_free_string(ptr: *mut std::os::raw::c_char) {
    if !ptr.is_null() {
        unsafe {
            let _ = CString::from_raw(ptr);
        }
    }
}
