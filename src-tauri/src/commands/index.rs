use std::path::Path;

use idepus_indexer::{
    ContextBundle, ContextChunk, IndexStatus, MentionInput, SearchResult, SEMANTIC_INDEX_AVAILABLE,
};
use serde::Deserialize;
use tauri::State;

use crate::error::AppError;
use crate::workspace::grep::{grep_workspace, GrepHit};
use crate::workspace::state::workspace_id;
use crate::workspace::WorkspaceState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexWorkspaceRequest {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCodebaseRequest {
    pub query: String,
    pub limit: Option<u32>,
    pub path_filter: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepWorkspaceRequest {
    pub pattern: String,
    pub path: Option<String>,
    pub glob: Option<String>,
    pub max_hits: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildContextRequest {
    pub query: String,
    pub mentions: Vec<MentionInput>,
    pub budget_tokens: Option<u32>,
}

#[tauri::command]
pub fn is_semantic_index_available() -> bool {
    SEMANTIC_INDEX_AVAILABLE
}

/// No-op until semantic indexer ships (local-ai deferred).
#[tauri::command]
pub fn index_workspace(
    workspace_state: State<'_, WorkspaceState>,
    req: IndexWorkspaceRequest,
) -> Result<(), AppError> {
    let _ = workspace_root_for(&workspace_state, &req.workspace_id)?;
    Ok(())
}

#[tauri::command]
pub fn search_codebase(
    workspace_state: State<'_, WorkspaceState>,
    req: SearchCodebaseRequest,
) -> Result<Vec<SearchResult>, AppError> {
    let root = workspace_state
        .root()
        .ok_or_else(|| AppError::Workspace("no workspace open".into()))?;
    let limit = req.limit.unwrap_or(10).max(1) as usize;
    let mut hits = stub_search(&root, &req.query, limit);
    if let Some(filter) = req.path_filter.as_deref() {
        let f = filter.to_lowercase();
        hits.retain(|h| h.path.to_lowercase().contains(&f));
    }
    Ok(hits)
}

#[tauri::command]
pub fn grep_workspace_cmd(
    workspace_state: State<'_, WorkspaceState>,
    req: GrepWorkspaceRequest,
) -> Result<Vec<GrepHit>, AppError> {
    let root = workspace_state
        .root()
        .ok_or_else(|| AppError::Workspace("no workspace open".into()))?;
    let matcher = workspace_state
        .matcher()
        .ok_or_else(|| AppError::Workspace("no workspace open".into()))?;
    let max_hits = req.max_hits.unwrap_or(50).max(1) as usize;
    grep_workspace(
        &root,
        &matcher,
        &req.pattern,
        req.path.as_deref(),
        req.glob.as_deref(),
        max_hits,
    )
}

#[tauri::command]
pub fn get_index_status(
    workspace_state: State<'_, WorkspaceState>,
    workspace_id: String,
) -> Result<IndexStatus, AppError> {
    let _ = workspace_root_for(&workspace_state, &workspace_id)?;
    Ok(IndexStatus::deferred())
}

#[tauri::command]
pub async fn build_context(
    workspace_state: State<'_, WorkspaceState>,
    req: BuildContextRequest,
) -> Result<ContextBundle, AppError> {
    let root = workspace_state
        .root()
        .ok_or_else(|| AppError::Workspace("no workspace open".into()))?;
    let budget = req.budget_tokens.unwrap_or(4000);
    let mut chunks: Vec<ContextChunk> = Vec::new();
    let mut tokens = 0u32;

    let hits = stub_search(&root, &req.query, 8);
    for hit in hits {
        let est = estimate_tokens(&hit.snippet);
        if tokens + est > budget {
            break;
        }
        tokens += est;
        chunks.push(ContextChunk {
            path: hit.path,
            start_line: hit.start_line,
            end_line: hit.end_line,
            content: hit.snippet,
            source: "path_search".into(),
        });
    }

    for mention in req.mentions {
        if tokens >= budget {
            break;
        }
        let path = root.join(&mention.path);
        if !path.starts_with(&root) || !path.is_file() {
            continue;
        }
        let content = std::fs::read_to_string(&path).map_err(|e| AppError::Io(e.to_string()))?;
        let snippet = truncate_chars(&content, 2000);
        let est = estimate_tokens(&snippet);
        if tokens + est > budget {
            break;
        }
        tokens += est;
        chunks.push(ContextChunk {
            path: mention.path,
            start_line: 1,
            end_line: content.lines().count() as u32,
            content: snippet,
            source: format!("mention:{}", mention.kind),
        });
    }

    Ok(ContextBundle {
        chunks,
        estimated_tokens: tokens,
    })
}

fn workspace_root_for(
    workspace_state: &WorkspaceState,
    expected_workspace_id: &str,
) -> Result<String, AppError> {
    let root = workspace_state
        .root()
        .ok_or_else(|| AppError::Workspace("no workspace open".into()))?;
    let root_str = root.to_string_lossy().to_string();
    if workspace_id(&root_str) != expected_workspace_id {
        return Err(AppError::Workspace("workspace_id mismatch".into()));
    }
    Ok(root_str)
}

fn stub_search(root: &Path, query: &str, limit: usize) -> Vec<SearchResult> {
    crate::bridge::search_stub::search_workspace(root, query, limit)
}

fn estimate_tokens(text: &str) -> u32 {
    ((text.len() as f32) / 4.0).ceil() as u32
}

fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    text.chars().take(max).collect::<String>() + "…"
}
