use std::ffi::{CStr, CString};
use std::path::{Path, PathBuf};

use idepus_plugin_api::{cstr_to_string, MentionSuggestion, PluginEntryFn};
use libloading::{Library, Symbol};

use crate::error::AppError;

pub struct LoadedPlugin {
    #[allow(dead_code)]
    library: Library,
    #[allow(dead_code)]
    name: String,
    suggest_fn: Option<SuggestFn>,
}

type SuggestFn = unsafe extern "C" fn(*const i8, *const i8) -> *mut i8;
type FreeFn = unsafe extern "C" fn(*mut i8);

pub struct PluginHost {
    plugins: Vec<LoadedPlugin>,
    free_fn: Option<FreeFn>,
}

impl PluginHost {
    pub fn load_all() -> Result<Self, AppError> {
        let mut host = Self {
            plugins: Vec::new(),
            free_fn: None,
        };
        for dir in plugin_dirs()? {
            if !dir.is_dir() {
                continue;
            }
            for entry in std::fs::read_dir(&dir).map_err(|e| AppError::Config(e.to_string()))? {
                let entry = entry.map_err(|e| AppError::Config(e.to_string()))?;
                let path = entry.path();
                if is_dylib(&path) {
                    host.load_one(&path)?;
                }
            }
        }
        Ok(host)
    }

    fn load_one(&mut self, path: &Path) -> Result<(), AppError> {
        let library = unsafe { Library::new(path) }
            .map_err(|e| AppError::Config(format!("load {}: {e}", path.display())))?;

        let entry: Symbol<PluginEntryFn> = unsafe { library.get(b"idepus_plugin_entry") }
            .map_err(|e| AppError::Config(format!("missing entry in {}: {e}", path.display())))?;
        let manifest = unsafe { entry() };
        let name = unsafe { cstr_to_string(manifest.plugin_name) }
            .unwrap_or_else(|| path.file_stem().and_then(|s| s.to_str()).unwrap_or("plugin").into());

        let suggest_fn = unsafe { library.get::<SuggestFn>(b"idepus_plugin_suggest") }
            .ok()
            .map(|sym| *sym);
        if self.free_fn.is_none() {
            self.free_fn = unsafe { library.get::<FreeFn>(b"idepus_plugin_free_string") }
                .ok()
                .map(|sym| *sym);
        }

        self.plugins.push(LoadedPlugin {
            library,
            name,
            suggest_fn,
        });
        Ok(())
    }

    pub fn plugin_count(&self) -> usize {
        self.plugins.len()
    }

    pub fn suggest(&self, query: &str, workspace_root: &Path) -> Vec<MentionSuggestion> {
        let query_c = CString::new(query).ok();
        let root_c = CString::new(workspace_root.to_string_lossy().as_bytes()).ok();
        let (Some(query_c), Some(root_c)) = (query_c, root_c) else {
            return vec![];
        };

        let mut out = Vec::new();
        for plugin in &self.plugins {
            let Some(suggest_fn) = plugin.suggest_fn else {
                continue;
            };
            let ptr = unsafe { suggest_fn(query_c.as_ptr(), root_c.as_ptr()) };
            if ptr.is_null() {
                continue;
            }
            let json = unsafe { CStr::from_ptr(ptr) }.to_string_lossy();
            if let Ok(items) = serde_json::from_str::<Vec<MentionSuggestion>>(&json) {
                out.extend(items);
            }
            if let Some(free) = self.free_fn {
                unsafe { free(ptr) };
            }
        }
        out
    }
}

fn is_dylib(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| matches!(ext, "so" | "dylib" | "dll"))
}

fn plugin_dirs() -> Result<Vec<PathBuf>, AppError> {
    let mut dirs = Vec::new();
    let home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")));
    if let Some(home) = home {
        dirs.push(home.join("idepus").join("plugins"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join(".idepus").join("plugins"));
    }
    Ok(dirs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_host_has_no_plugins() {
        let host = PluginHost {
            plugins: vec![],
            free_fn: None,
        };
        assert_eq!(host.plugin_count(), 0);
    }
}
