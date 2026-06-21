use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const SUPPRESS_MS: u128 = 500;

#[derive(Clone, Default)]
pub struct SelfWriteFilter {
    inner: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl SelfWriteFilter {
    pub fn record(&self, path: &Path) {
        let mut guard = self.inner.lock().expect("self_write lock");
        guard.insert(path.to_path_buf(), Instant::now());
        if let Ok(canonical) = path.canonicalize() {
            guard.insert(canonical, Instant::now());
        }
    }

    pub fn should_suppress(&self, path: &Path) -> bool {
        let Ok(mut guard) = self.inner.lock() else {
            return false;
        };
        let now = Instant::now();
        let keys: Vec<PathBuf> = guard.keys().cloned().collect();
        for key in keys {
            if let Some(recorded) = guard.get(&key) {
                if now.duration_since(*recorded).as_millis() > SUPPRESS_MS {
                    guard.remove(&key);
                    continue;
                }
                if paths_match(path, &key) {
                    return true;
                }
            }
        }
        false
    }
}

fn paths_match(a: &Path, b: &Path) -> bool {
    a == b
        || a.to_string_lossy() == b.to_string_lossy()
        || a.canonicalize()
            .ok()
            .zip(b.canonicalize().ok())
            .map(|(x, y)| x == y)
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn suppresses_recent_write() {
        let filter = SelfWriteFilter::default();
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("a.txt");
        fs::write(&file, "x").unwrap();
        filter.record(&file);
        assert!(filter.should_suppress(&file));
    }

    #[test]
    fn expires_after_window() {
        let filter = SelfWriteFilter::default();
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("a.txt");
        fs::write(&file, "x").unwrap();
        {
            let mut guard = filter.inner.lock().unwrap();
            guard.insert(
                file.clone(),
                Instant::now() - Duration::from_millis(SUPPRESS_MS as u64 + 50),
            );
        }
        assert!(!filter.should_suppress(&file));
    }
}
