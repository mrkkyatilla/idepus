use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use ignore::gitignore::Gitignore;
use notify::{
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as NotifyWatcher,
};
use tauri::{AppHandle, Emitter};

use crate::error::AppError;
use crate::workspace::ignore::is_ignored;
use crate::workspace::types::{FileChangeEvent, FileChangeKind};

pub struct WatcherHandle {
    _watcher: RecommendedWatcher,
    stop: Arc<Mutex<bool>>,
}

impl WatcherHandle {
    pub fn stop(&self) {
        if let Ok(mut guard) = self.stop.lock() {
            *guard = true;
        }
    }
}

pub fn start_watcher(
    app: AppHandle,
    root: PathBuf,
    matcher: Arc<Gitignore>,
    self_write: crate::workspace::self_write::SelfWriteFilter,
) -> Result<WatcherHandle, AppError> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default(),
    )
    .map_err(|e| AppError::Watch(e.to_string()))?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| AppError::Watch(e.to_string()))?;

    let stop = Arc::new(Mutex::new(false));
    let stop_flag = stop.clone();
    let root_clone = root.clone();
    let filter = self_write;

    std::thread::spawn(move || {
        let mut pending: HashMap<String, FileChangeEvent> = HashMap::new();
        let mut last_event = Instant::now();
        const DEBOUNCE: Duration = Duration::from_millis(300);

        loop {
            if *stop_flag.lock().expect("stop lock") {
                break;
            }

            match rx.recv_timeout(DEBOUNCE) {
                Ok(event) => {
                    merge_event(&root_clone, &matcher, &filter, event, &mut pending);
                    last_event = Instant::now();
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if !pending.is_empty() && last_event.elapsed() >= DEBOUNCE {
                        flush_pending(&app, &mut pending);
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Ok(WatcherHandle {
        _watcher: watcher,
        stop,
    })
}

fn merge_event(
    root: &Path,
    matcher: &Gitignore,
    self_write: &crate::workspace::self_write::SelfWriteFilter,
    event: Event,
    pending: &mut HashMap<String, FileChangeEvent>,
) {
    let paths: Vec<PathBuf> = event.paths;
    if paths.is_empty() {
        return;
    }

    let is_rename = matches!(
        event.kind,
        EventKind::Modify(notify::event::ModifyKind::Name(_))
    );

    if is_rename || paths.len() >= 2 {
        let old_path = paths[0].to_string_lossy().to_string();
        let new_path = paths
            .get(1)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| old_path.clone());

        if should_emit(root, matcher, self_write, Path::new(&new_path)) {
            pending.insert(
                new_path.clone(),
                FileChangeEvent {
                    path: new_path,
                    kind: FileChangeKind::Renamed,
                    old_path: Some(old_path),
                },
            );
        }
        return;
    }

    let kind = match event.kind {
        EventKind::Create(_) => FileChangeKind::Created,
        EventKind::Modify(_) => FileChangeKind::Modified,
        EventKind::Remove(_) => FileChangeKind::Deleted,
        EventKind::Any => FileChangeKind::Modified,
        EventKind::Access(_) | EventKind::Other => return,
    };

    for path in paths {
        if !should_emit(root, matcher, self_write, &path) {
            continue;
        }
        let path_str = path.to_string_lossy().to_string();
        pending.insert(
            path_str.clone(),
            FileChangeEvent {
                path: path_str,
                kind,
                old_path: None,
            },
        );
    }
}

fn should_emit(
    root: &Path,
    matcher: &Gitignore,
    self_write: &crate::workspace::self_write::SelfWriteFilter,
    path: &Path,
) -> bool {
    if self_write.should_suppress(path) {
        return false;
    }
    if !path.starts_with(root) {
        return false;
    }
    let is_dir = path.is_dir();
    !is_ignored(matcher, path, is_dir)
}

fn flush_pending(app: &AppHandle, pending: &mut HashMap<String, FileChangeEvent>) {
    for (_, event) in pending.drain() {
        let app_for_emit = app.clone();
        let event_clone = event.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = app_for_emit.emit("file_changed", event_clone);
        });
    }
}
