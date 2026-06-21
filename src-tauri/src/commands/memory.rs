use std::fs;
use std::io::BufRead;
use std::path::{Path, PathBuf};

use idepus_indexer::SEMANTIC_INDEX_AVAILABLE;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::commands::file::write_atomic;
use crate::error::AppError;
use crate::workspace::state::workspace_id;
use crate::workspace::WorkspaceState;

const MAX_CHANGES_PER_WORKSPACE: usize = 500;
const MAX_DIFF_EXCERPT: usize = 2048;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecord {
    pub id: String,
    pub session_id: String,
    pub workspace_id: String,
    #[serde(rename = "type")]
    pub memory_type: String,
    pub text: String,
    #[serde(default)]
    pub refs: Vec<String>,
    pub created_at: u64,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStoreFile {
    #[serde(default)]
    pub memories: Vec<MemoryRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRecord {
    pub id: String,
    pub workspace_id: String,
    pub run_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub path: String,
    pub summary: String,
    pub diff_excerpt: String,
    pub accepted_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMemoriesRequest {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMemoriesRequest {
    pub workspace_id: String,
    pub query: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertMemoriesRequest {
    pub workspace_id: String,
    pub records: Vec<MemoryRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryIdRequest {
    pub workspace_id: String,
    pub memory_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexChangeRequest {
    pub record: ChangeRecord,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchChangesRequest {
    pub workspace_id: String,
    pub query: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRecentChangesRequest {
    pub workspace_id: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListChangesByRunRequest {
    pub workspace_id: String,
    pub run_id: String,
}

fn memory_dir(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".idepus/memory")
}

fn changes_dir(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".idepus/changes")
}

fn memory_file(workspace_root: &Path, ws_id: &str) -> PathBuf {
    memory_dir(workspace_root).join(format!("{ws_id}.json"))
}

fn changes_file(workspace_root: &Path, ws_id: &str) -> PathBuf {
    changes_dir(workspace_root).join(format!("{ws_id}.jsonl"))
}

fn ensure_workspace(
    workspace_state: &WorkspaceState,
    expected_workspace_id: &str,
) -> Result<PathBuf, AppError> {
    let root = workspace_state
        .root()
        .ok_or_else(|| AppError::Workspace("no workspace open".into()))?;
    let root_str = root.to_string_lossy().to_string();
    if workspace_id(&root_str) != expected_workspace_id {
        return Err(AppError::Workspace("workspace_id mismatch".into()));
    }
    Ok(root)
}

fn load_memories(path: &Path) -> Result<Vec<MemoryRecord>, AppError> {
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path).map_err(|e| AppError::Io(e.to_string()))?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    let store: MemoryStoreFile =
        serde_json::from_str(&raw).map_err(|e| AppError::Config(e.to_string()))?;
    Ok(store.memories)
}

fn save_memories(path: &Path, memories: &[MemoryRecord]) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let store = MemoryStoreFile {
        memories: memories.to_vec(),
    };
    let json = serde_json::to_string_pretty(&store).map_err(|e| AppError::Config(e.to_string()))?;
    write_atomic(path, json.as_bytes())
}

fn load_changes(path: &Path) -> Result<Vec<ChangeRecord>, AppError> {
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let file = fs::File::open(path).map_err(|e| AppError::Io(e.to_string()))?;
    let reader = std::io::BufReader::new(file);
    let mut out = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| AppError::Io(e.to_string()))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(record) = serde_json::from_str::<ChangeRecord>(trimmed) {
            out.push(record);
        }
    }
    Ok(out)
}

fn append_change(path: &Path, record: &ChangeRecord) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let mut changes = load_changes(path)?;
    changes.push(record.clone());
    if changes.len() > MAX_CHANGES_PER_WORKSPACE {
        changes = changes.split_off(changes.len() - MAX_CHANGES_PER_WORKSPACE);
    }
    let json_lines = changes
        .iter()
        .map(|c| serde_json::to_string(c))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Config(e.to_string()))?;
    write_atomic(path, json_lines.join("\n").as_bytes())
}

fn keyword_score(query: &str, haystack: &str) -> f32 {
    let q = query.to_lowercase();
    let h = haystack.to_lowercase();
    if q.is_empty() {
        return 0.0;
    }
    if h.contains(&q) {
        return 1.0;
    }
    let terms: Vec<&str> = q.split_whitespace().collect();
    if terms.is_empty() {
        return 0.0;
    }
    let hits = terms.iter().filter(|t| h.contains(**t)).count();
    hits as f32 / terms.len() as f32
}

#[tauri::command]
pub fn is_semantic_memory_available() -> bool {
    SEMANTIC_INDEX_AVAILABLE
}

#[tauri::command]
pub fn list_memories(
    workspace_state: State<'_, WorkspaceState>,
    req: ListMemoriesRequest,
) -> Result<Vec<MemoryRecord>, AppError> {
    let root = ensure_workspace(&workspace_state, &req.workspace_id)?;
    let path = memory_file(&root, &req.workspace_id);
    let mut memories = load_memories(&path)?;
    memories.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(memories)
}

#[tauri::command]
pub fn search_memories(
    workspace_state: State<'_, WorkspaceState>,
    req: SearchMemoriesRequest,
) -> Result<Vec<MemoryRecord>, AppError> {
    let root = ensure_workspace(&workspace_state, &req.workspace_id)?;
    let path = memory_file(&root, &req.workspace_id);
    let memories = load_memories(&path)?;
    let limit = req.limit.unwrap_or(8).max(1) as usize;
    let query = req.query.trim();
    if query.is_empty() {
        let mut pinned: Vec<_> = memories.into_iter().filter(|m| m.pinned).collect();
        pinned.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        return Ok(pinned.into_iter().take(limit).collect());
    }

    let mut scored: Vec<(f32, MemoryRecord)> = memories
        .into_iter()
        .map(|m| {
            let text = format!("{} {}", m.text, m.refs.join(" "));
            let mut score = keyword_score(query, &text);
            if m.pinned {
                score += 0.25;
            }
            (score, m)
        })
        .filter(|(s, _)| *s > 0.0)
        .collect();
    scored.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.1.created_at.cmp(&a.1.created_at))
    });
    Ok(scored.into_iter().take(limit).map(|(_, m)| m).collect())
}

#[tauri::command]
pub fn upsert_memories(
    workspace_state: State<'_, WorkspaceState>,
    req: UpsertMemoriesRequest,
) -> Result<Vec<MemoryRecord>, AppError> {
    let root = ensure_workspace(&workspace_state, &req.workspace_id)?;
    let path = memory_file(&root, &req.workspace_id);
    let mut memories = load_memories(&path)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    for mut incoming in req.records {
        if incoming.id.is_empty() {
            incoming.id = format!("mem-{}", Uuid::new_v4());
        }
        if incoming.created_at == 0 {
            incoming.created_at = now;
        }
        incoming.workspace_id = req.workspace_id.clone();
        let dup = memories.iter().position(|m| {
            m.text.trim().eq_ignore_ascii_case(incoming.text.trim())
                && m.memory_type == incoming.memory_type
        });
        if let Some(idx) = dup {
            let existing = &mut memories[idx];
            existing.created_at = incoming.created_at.max(existing.created_at);
            if incoming.pinned {
                existing.pinned = true;
            }
            for r in incoming.refs {
                if !existing.refs.contains(&r) {
                    existing.refs.push(r);
                }
            }
        } else {
            memories.push(incoming);
        }
    }

    memories.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    save_memories(&path, &memories)?;
    Ok(memories)
}

#[tauri::command]
pub fn pin_memory(
    workspace_state: State<'_, WorkspaceState>,
    req: MemoryIdRequest,
) -> Result<MemoryRecord, AppError> {
    let root = ensure_workspace(&workspace_state, &req.workspace_id)?;
    let path = memory_file(&root, &req.workspace_id);
    let mut memories = load_memories(&path)?;
    let item = memories
        .iter_mut()
        .find(|m| m.id == req.memory_id)
        .ok_or_else(|| AppError::Config("memory not found".into()))?;
    item.pinned = true;
    let out = item.clone();
    save_memories(&path, &memories)?;
    Ok(out)
}

#[tauri::command]
pub fn forget_memory(
    workspace_state: State<'_, WorkspaceState>,
    req: MemoryIdRequest,
) -> Result<(), AppError> {
    let root = ensure_workspace(&workspace_state, &req.workspace_id)?;
    let path = memory_file(&root, &req.workspace_id);
    let mut memories = load_memories(&path)?;
    let before = memories.len();
    memories.retain(|m| m.id != req.memory_id);
    if memories.len() == before {
        return Err(AppError::Config("memory not found".into()));
    }
    save_memories(&path, &memories)?;
    Ok(())
}

#[tauri::command]
pub fn index_change(
    workspace_state: State<'_, WorkspaceState>,
    req: IndexChangeRequest,
) -> Result<ChangeRecord, AppError> {
    let root = ensure_workspace(&workspace_state, &req.record.workspace_id)?;
    let path = changes_file(&root, &req.record.workspace_id);
    let mut record = req.record;
    if record.id.is_empty() {
        record.id = format!("chg-{}", Uuid::new_v4());
    }
    if record.accepted_at == 0 {
        record.accepted_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
    }
    if record.diff_excerpt.chars().count() > MAX_DIFF_EXCERPT {
        record.diff_excerpt = record.diff_excerpt.chars().take(MAX_DIFF_EXCERPT).collect();
    }
    append_change(&path, &record)?;
    Ok(record)
}

#[tauri::command]
pub fn search_changes(
    workspace_state: State<'_, WorkspaceState>,
    req: SearchChangesRequest,
) -> Result<Vec<ChangeRecord>, AppError> {
    let root = ensure_workspace(&workspace_state, &req.workspace_id)?;
    let path = changes_file(&root, &req.workspace_id);
    let changes = load_changes(&path)?;
    let limit = req.limit.unwrap_or(10).max(1) as usize;
    let query = req.query.trim();
    if query.is_empty() {
        let mut recent = changes;
        recent.sort_by(|a, b| b.accepted_at.cmp(&a.accepted_at));
        return Ok(recent.into_iter().take(limit).collect());
    }

    let mut scored: Vec<(f32, ChangeRecord)> = changes
        .into_iter()
        .map(|c| {
            let text = format!("{} {} {}", c.path, c.summary, c.diff_excerpt);
            (keyword_score(query, &text), c)
        })
        .filter(|(s, _)| *s > 0.0)
        .collect();
    scored.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.1.accepted_at.cmp(&a.1.accepted_at))
    });
    Ok(scored.into_iter().take(limit).map(|(_, c)| c).collect())
}

#[tauri::command]
pub fn list_recent_changes(
    workspace_state: State<'_, WorkspaceState>,
    req: ListRecentChangesRequest,
) -> Result<Vec<ChangeRecord>, AppError> {
    let root = ensure_workspace(&workspace_state, &req.workspace_id)?;
    let path = changes_file(&root, &req.workspace_id);
    let limit = req.limit.unwrap_or(50).max(1) as usize;
    let mut changes = load_changes(&path)?;
    changes.sort_by(|a, b| b.accepted_at.cmp(&a.accepted_at));
    Ok(changes.into_iter().take(limit).collect())
}

#[tauri::command]
pub fn list_changes_by_run(
    workspace_state: State<'_, WorkspaceState>,
    req: ListChangesByRunRequest,
) -> Result<Vec<ChangeRecord>, AppError> {
    let root = ensure_workspace(&workspace_state, &req.workspace_id)?;
    let path = changes_file(&root, &req.workspace_id);
    let changes = load_changes(&path)?;
    Ok(changes
        .into_iter()
        .filter(|c| c.run_id == req.run_id)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn keyword_score_partial_match() {
        assert!(keyword_score("auth refactor", "refactored auth module") > 0.0);
    }

    #[test]
    fn memory_roundtrip() {
        let dir = env::temp_dir().join(format!("idepus-mem-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mem.json");
        let records = vec![MemoryRecord {
            id: "m1".into(),
            session_id: "s1".into(),
            workspace_id: "w1".into(),
            memory_type: "decision".into(),
            text: "Use tRPC".into(),
            refs: vec![],
            created_at: 1,
            pinned: false,
        }];
        save_memories(&path, &records).unwrap();
        let loaded = load_memories(&path).unwrap();
        assert_eq!(loaded.len(), 1);
        let _ = fs::remove_dir_all(dir);
    }
}
