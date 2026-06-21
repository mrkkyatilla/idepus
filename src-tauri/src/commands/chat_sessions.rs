use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

const MAX_RUN_ARCHIVES: usize = 200;
const RETENTION_MS: u64 = 90 * 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub mode: String,
    pub messages: Vec<serde_json::Value>,
    pub workspace_id: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_plan_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft_composer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_queue: Option<Vec<serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub mode: String,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionIndex {
    pub workspace_id: String,
    #[serde(default)]
    pub sessions: Vec<SessionSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_session_id: Option<String>,
    #[serde(default)]
    pub open_session_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunArchive {
    pub run_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub agent_id: String,
    pub input_summary: String,
    pub status: String,
    pub steps: Vec<serde_json::Value>,
    pub files_touched: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_preview: Option<String>,
    pub started_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunArchiveMeta {
    pub run_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub agent_id: String,
    pub input_summary: String,
    pub status: String,
    pub started_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunArchiveIndex {
    #[serde(default)]
    pub runs: Vec<RunArchiveMeta>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRunArchivesQuery {
    pub workspace_id: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub days: Option<u32>,
}

fn config_dir() -> Result<PathBuf, AppError> {
    let home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| AppError::Config("cannot resolve config dir".into()))?;
    Ok(home.join("idepus"))
}

fn sanitize_workspace_id(workspace_id: &str) -> String {
    let trimmed = workspace_id.trim();
    if trimmed.is_empty() {
        return "default".into();
    }
    let safe: String = trimmed
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    safe.chars().take(128).collect()
}

fn sanitize_session_id(session_id: &str) -> Result<String, AppError> {
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        return Err(AppError::Config("session id required".into()));
    }
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppError::Config("invalid session id".into()));
    }
    Ok(trimmed.to_string())
}

fn sanitize_run_id(run_id: &str) -> Result<String, AppError> {
    let trimmed = run_id.trim();
    if trimmed.is_empty() {
        return Err(AppError::Config("run id required".into()));
    }
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppError::Config("invalid run id".into()));
    }
    Ok(trimmed.to_string())
}

fn write_atomic(path: &PathBuf, data: &str) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Config(e.to_string()))?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).map_err(|e| AppError::Config(e.to_string()))?;
    fs::rename(&tmp, path).map_err(|e| AppError::Config(e.to_string()))?;
    Ok(())
}

fn workspace_dir(workspace_id: &str) -> Result<PathBuf, AppError> {
    Ok(config_dir()?.join("chats").join(sanitize_workspace_id(workspace_id)))
}

fn workspace_index_path(workspace_id: &str) -> Result<PathBuf, AppError> {
    Ok(workspace_dir(workspace_id)?.join("index.json"))
}

fn session_path(workspace_id: &str, session_id: &str) -> Result<PathBuf, AppError> {
    let sid = sanitize_session_id(session_id)?;
    Ok(workspace_dir(workspace_id)?.join(format!("{sid}.json")))
}

fn runs_dir() -> Result<PathBuf, AppError> {
    Ok(config_dir()?.join("runs"))
}

fn run_archive_path(run_id: &str) -> Result<PathBuf, AppError> {
    let rid = sanitize_run_id(run_id)?;
    Ok(runs_dir()?.join(format!("{rid}.json")))
}

fn run_index_path() -> Result<PathBuf, AppError> {
    Ok(runs_dir()?.join("index.json"))
}

fn load_workspace_index(workspace_id: &str) -> Result<WorkspaceSessionIndex, AppError> {
    let path = workspace_index_path(workspace_id)?;
    if !path.exists() {
        return Ok(WorkspaceSessionIndex {
            workspace_id: workspace_id.to_string(),
            sessions: vec![],
            active_session_id: None,
            open_session_ids: vec![],
        });
    }
    let text = fs::read_to_string(&path).map_err(|e| AppError::Config(e.to_string()))?;
    serde_json::from_str(&text).map_err(|e| AppError::Config(e.to_string()))
}

fn save_workspace_index(index: &WorkspaceSessionIndex) -> Result<(), AppError> {
    let path = workspace_index_path(&index.workspace_id)?;
    let data =
        serde_json::to_string_pretty(index).map_err(|e| AppError::Config(e.to_string()))?;
    write_atomic(&path, &data)
}

fn load_run_index() -> Result<RunArchiveIndex, AppError> {
    let path = run_index_path()?;
    if !path.exists() {
        return Ok(RunArchiveIndex::default());
    }
    let text = fs::read_to_string(&path).map_err(|e| AppError::Config(e.to_string()))?;
    serde_json::from_str(&text).map_err(|e| AppError::Config(e.to_string()))
}

fn save_run_index(index: &RunArchiveIndex) -> Result<(), AppError> {
    let path = run_index_path()?;
    let data =
        serde_json::to_string_pretty(index).map_err(|e| AppError::Config(e.to_string()))?;
    write_atomic(&path, &data)
}

fn prune_run_index(index: &mut RunArchiveIndex) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let cutoff = now.saturating_sub(RETENTION_MS);

    index.runs.retain(|meta| {
        meta.ended_at.unwrap_or(meta.started_at) >= cutoff
    });

    index.runs.sort_by(|a, b| {
        let ae = a.ended_at.unwrap_or(a.started_at);
        let be = b.ended_at.unwrap_or(b.started_at);
        be.cmp(&ae)
    });

    if index.runs.len() > MAX_RUN_ARCHIVES {
        let removed: Vec<String> = index
            .runs
            .drain(MAX_RUN_ARCHIVES..)
            .map(|m| m.run_id)
            .collect();
        for run_id in removed {
            if let Ok(path) = run_archive_path(&run_id) {
                let _ = fs::remove_file(path);
            }
        }
    }
}

#[tauri::command]
pub fn list_chat_sessions(workspace_id: String) -> Result<WorkspaceSessionIndex, AppError> {
    load_workspace_index(&workspace_id)
}

#[tauri::command]
pub fn load_chat_session(
    workspace_id: String,
    session_id: String,
) -> Result<Option<ChatSession>, AppError> {
    let path = session_path(&workspace_id, &session_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| AppError::Config(e.to_string()))?;
    let session: ChatSession =
        serde_json::from_str(&text).map_err(|e| AppError::Config(e.to_string()))?;
    Ok(Some(session))
}

#[tauri::command]
pub fn save_chat_session(session: ChatSession) -> Result<(), AppError> {
    let path = session_path(&session.workspace_id, &session.id)?;
    let data =
        serde_json::to_string_pretty(&session).map_err(|e| AppError::Config(e.to_string()))?;
    write_atomic(&path, &data)?;

    let mut index = load_workspace_index(&session.workspace_id)?;
    index.workspace_id = session.workspace_id.clone();
    let summary = SessionSummary {
        id: session.id.clone(),
        title: session.title.clone(),
        mode: session.mode.clone(),
        updated_at: session.updated_at,
    };
    if let Some(pos) = index.sessions.iter().position(|s| s.id == session.id) {
        index.sessions[pos] = summary;
    } else {
        index.sessions.push(summary);
    }
    index.sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    save_workspace_index(&index)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorkspaceIndexRequest {
    pub workspace_id: String,
    pub active_session_id: Option<String>,
    pub open_session_ids: Vec<String>,
}

#[tauri::command]
pub fn save_workspace_session_index(req: SaveWorkspaceIndexRequest) -> Result<(), AppError> {
    let mut index = load_workspace_index(&req.workspace_id)?;
    index.active_session_id = req.active_session_id;
    index.open_session_ids = req.open_session_ids;
    save_workspace_index(&index)
}

#[tauri::command]
pub fn delete_chat_session(workspace_id: String, session_id: String) -> Result<(), AppError> {
    let sid = sanitize_session_id(&session_id)?;
    let path = session_path(&workspace_id, &sid)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| AppError::Config(e.to_string()))?;
    }

    let mut index = load_workspace_index(&workspace_id)?;
    index.sessions.retain(|s| s.id != sid);
    if index.active_session_id.as_deref() == Some(sid.as_str()) {
        index.active_session_id = index.sessions.first().map(|s| s.id.clone());
    }
    index.open_session_ids.retain(|id| id != &sid);
    save_workspace_index(&index)
}

#[tauri::command]
pub fn save_run_archive(archive: RunArchive) -> Result<(), AppError> {
    let path = run_archive_path(&archive.run_id)?;
    let data =
        serde_json::to_string_pretty(&archive).map_err(|e| AppError::Config(e.to_string()))?;
    write_atomic(&path, &data)?;

    let mut index = load_run_index()?;
    let meta = RunArchiveMeta {
        run_id: archive.run_id.clone(),
        workspace_id: archive.workspace_id.clone(),
        session_id: archive.session_id.clone(),
        agent_id: archive.agent_id.clone(),
        input_summary: archive.input_summary.clone(),
        status: archive.status.clone(),
        started_at: archive.started_at,
        ended_at: archive.ended_at,
    };
    if let Some(pos) = index.runs.iter().position(|r| r.run_id == archive.run_id) {
        index.runs[pos] = meta;
    } else {
        index.runs.push(meta);
    }
    prune_run_index(&mut index);
    save_run_index(&index)
}

#[tauri::command]
pub fn list_run_archives(query: ListRunArchivesQuery) -> Result<Vec<RunArchiveMeta>, AppError> {
    let index = load_run_index()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let days_ms = query.days.unwrap_or(30) as u64 * 24 * 60 * 60 * 1000;
    let cutoff = now.saturating_sub(days_ms);
    let offset = query.offset.unwrap_or(0) as usize;
    let limit = query.limit.unwrap_or(20) as usize;

    let filtered: Vec<RunArchiveMeta> = index
        .runs
        .into_iter()
        .filter(|meta| {
            if let Some(ref ws) = query.workspace_id {
                if &meta.workspace_id != ws {
                    return false;
                }
            }
            meta.ended_at.unwrap_or(meta.started_at) >= cutoff
        })
        .skip(offset)
        .take(limit)
        .collect();

    Ok(filtered)
}

#[tauri::command]
pub fn load_run_archive(run_id: String) -> Result<Option<RunArchive>, AppError> {
    let path = run_archive_path(&run_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| AppError::Config(e.to_string()))?;
    let archive: RunArchive =
        serde_json::from_str(&text).map_err(|e| AppError::Config(e.to_string()))?;
    Ok(Some(archive))
}

#[tauri::command]
pub fn delete_run_archive(run_id: String) -> Result<(), AppError> {
    let rid = sanitize_run_id(&run_id)?;
    let path = run_archive_path(&rid)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| AppError::Config(e.to_string()))?;
    }
    let mut index = load_run_index()?;
    index.runs.retain(|r| r.run_id != rid);
    save_run_index(&index)
}

#[tauri::command]
pub fn clear_workspace_history(workspace_id: String) -> Result<(), AppError> {
    let ws = sanitize_workspace_id(&workspace_id);
    let chats = workspace_dir(&ws)?;
    if chats.exists() {
        fs::remove_dir_all(&chats).map_err(|e| AppError::Config(e.to_string()))?;
    }

    let mut index = load_run_index()?;
    let removed: Vec<String> = index
        .runs
        .iter()
        .filter(|r| r.workspace_id == ws)
        .map(|r| r.run_id.clone())
        .collect();
    index.runs.retain(|r| r.workspace_id != ws);
    save_run_index(&index)?;

    for run_id in removed {
        if let Ok(path) = run_archive_path(&run_id) {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_idepus_data_paths() -> Result<serde_json::Value, AppError> {
    let base = config_dir()?;
    Ok(serde_json::json!({
        "configDir": base.display().to_string(),
        "chatsDir": base.join("chats").display().to_string(),
        "runsDir": base.join("runs").display().to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_workspace_rejects_traversal() {
        let s = sanitize_workspace_id("../etc");
        assert!(!s.contains('/'));
    }

    #[test]
    fn session_id_rejects_path() {
        assert!(sanitize_session_id("../x").is_err());
    }
}
