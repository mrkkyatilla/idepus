use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use ignore::gitignore::Gitignore;
use tauri::AppHandle;

use crate::error::AppError;
use crate::workspace::ignore::build_gitignore;
use crate::workspace::list::canonicalize;
use crate::workspace::recent::promote_workspace;
use crate::workspace::self_write::SelfWriteFilter;
use crate::workspace::types::WorkspaceInfo;
use crate::workspace::watcher::{start_watcher, WatcherHandle};

pub struct WorkspaceState {
    inner: Mutex<WorkspaceInner>,
    self_write: SelfWriteFilter,
}

struct WorkspaceInner {
    root: Option<PathBuf>,
    matcher: Option<Arc<Gitignore>>,
    watcher: Option<WatcherHandle>,
}

impl WorkspaceState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(WorkspaceInner {
                root: None,
                matcher: None,
                watcher: None,
            }),
            self_write: SelfWriteFilter::default(),
        }
    }

    pub fn open(&self, app: AppHandle, path: &str) -> Result<WorkspaceInfo, AppError> {
        let canonical = canonicalize(Path::new(path))?;
        if !canonical.is_dir() {
            return Err(AppError::Workspace(format!(
                "not a directory: {}",
                canonical.display()
            )));
        }

        let matcher = Arc::new(build_gitignore(&canonical)?);

        let old_watcher = {
            let mut guard = self.inner.lock().expect("workspace lock");
            guard.watcher.take()
        };
        if let Some(watcher) = old_watcher {
            watcher.stop();
        }

        let self_write = self.self_write.clone();
        let watcher = start_watcher(app, canonical.clone(), matcher.clone(), self_write)?;

        let root_str = canonical.to_string_lossy().to_string();
        let name = canonical
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("workspace")
            .to_string();

        {
            let mut guard = self.inner.lock().expect("workspace lock");
            guard.root = Some(canonical);
            guard.matcher = Some(matcher);
            guard.watcher = Some(watcher);
        }

        promote_workspace(&root_str)?;

        Ok(WorkspaceInfo {
            root_path: root_str.clone(),
            name,
            workspace_id: workspace_id(&root_str),
        })
    }

    pub fn close(&self) {
        let mut guard = self.inner.lock().expect("workspace lock");
        if let Some(watcher) = guard.watcher.take() {
            watcher.stop();
        }
        guard.root = None;
        guard.matcher = None;
    }

    pub fn root(&self) -> Option<PathBuf> {
        self.inner.lock().expect("workspace lock").root.clone()
    }

    pub fn matcher(&self) -> Option<Arc<Gitignore>> {
        self.inner
            .lock()
            .expect("workspace lock")
            .matcher
            .clone()
    }

    pub fn record_self_write(&self, path: &Path) {
        self.self_write.record(path);
    }

    #[cfg(test)]
    pub fn set_root_for_test(&self, root: PathBuf) {
        self.inner.lock().expect("workspace lock").root = Some(root);
    }
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self::new()
    }
}

pub fn workspace_id(path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_id_is_stable() {
        assert_eq!(workspace_id("/a/b"), workspace_id("/a/b"));
        assert_ne!(workspace_id("/a/b"), workspace_id("/a/c"));
    }
}
