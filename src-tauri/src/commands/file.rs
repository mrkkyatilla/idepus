use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use tauri::State;

use crate::error::AppError;
use crate::workspace::WorkspaceState;

#[tauri::command]
pub fn read_file(path: String) -> Result<String, AppError> {
    fs::read_to_string(&path).map_err(|err| map_read_error(&path, err))
}

#[tauri::command]
pub fn write_file(
    state: State<'_, WorkspaceState>,
    path: String,
    content: String,
) -> Result<(), AppError> {
    let target = Path::new(&path);
    write_atomic(target, content.as_bytes())?;
    state.record_self_write(target);
    Ok(())
}

#[tauri::command]
pub fn open_file_dialog(app: AppHandle) -> Result<Option<String>, AppError> {
    let (tx, rx) = mpsc::sync_channel(1);
    app.dialog()
        .file()
        .pick_file(move |file| {
            let _ = tx.send(file);
        });

    let picked = rx
        .recv_timeout(Duration::from_secs(300))
        .map_err(|e| AppError::Io(e.to_string()))?;

    Ok(picked.and_then(|p| p.into_path().ok().map(|path| path.to_string_lossy().into_owned())))
}

#[tauri::command]
pub fn save_file_dialog(app: AppHandle) -> Result<Option<String>, AppError> {
    let (tx, rx) = mpsc::sync_channel(1);
    app.dialog()
        .file()
        .save_file(move |file| {
            let _ = tx.send(file);
        });

    let picked = rx
        .recv_timeout(Duration::from_secs(300))
        .map_err(|e| AppError::Io(e.to_string()))?;

    Ok(picked.and_then(|p| p.into_path().ok().map(|path| path.to_string_lossy().into_owned())))
}

pub fn write_atomic(path: &Path, content: &[u8]) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Io("path has no parent directory".into()))?;

    fs::create_dir_all(parent)?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");

    let temp_path = parent.join(format!(".{file_name}.idepus.tmp"));

    {
        let mut file = fs::File::create(&temp_path)?;
        file.write_all(content)?;
        file.sync_all()?;
    }

    fs::rename(&temp_path, path).map_err(AppError::from)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_atomic_roundtrip() {
        let dir = std::env::temp_dir().join("idepus-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sample.txt");

        write_atomic(&path, b"hello idepus").unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "hello idepus");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_missing_file_returns_not_found() {
        let err = fs::read_to_string("/tmp/idepus-does-not-exist-xyz").unwrap_err();
        let app_err = map_read_error("/tmp/idepus-does-not-exist-xyz", err);
        assert!(matches!(app_err, AppError::NotFound(_)));
    }
}

fn map_read_error(path: &str, err: std::io::Error) -> AppError {
    use std::io::ErrorKind;

    match err.kind() {
        ErrorKind::NotFound => AppError::NotFound(path.to_string()),
        ErrorKind::PermissionDenied => AppError::PermissionDenied(path.to_string()),
        ErrorKind::InvalidData => AppError::InvalidUtf8(path.to_string()),
        _ => AppError::Io(err.to_string()),
    }
}
