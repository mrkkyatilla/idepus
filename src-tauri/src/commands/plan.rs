use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::commands::file::write_atomic;
use crate::error::AppError;
use crate::workspace::WorkspaceState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Draft,
    Approved,
    Implementing,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanMeta {
    pub id: String,
    pub path: String,
    pub title: String,
    pub status: PlanStatus,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implement_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDocument {
    pub meta: PlanMeta,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritePlanFileRequest {
    pub title: String,
    pub content: String,
    pub plan_id: Option<String>,
    pub run_id: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadPlanRequest {
    pub plan_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritePlanRequest {
    pub plan_id: String,
    pub content: String,
    pub title: Option<String>,
    pub status: Option<PlanStatus>,
    pub implement_run_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlanStatusRequest {
    pub plan_id: String,
    pub status: PlanStatus,
    pub implement_run_id: Option<String>,
}

fn plans_dir(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".idepus/plans")
}

fn plan_md_path(workspace_root: &Path, plan_id: &str) -> PathBuf {
    plans_dir(workspace_root).join(format!("{plan_id}.md"))
}

fn plan_meta_path(workspace_root: &Path, plan_id: &str) -> PathBuf {
    plans_dir(workspace_root).join(format!("{plan_id}.json"))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn workspace_root(state: &WorkspaceState) -> Result<PathBuf, AppError> {
    state
        .root()
        .ok_or_else(|| AppError::Workspace("no workspace open".into()))
}

fn validate_plan_id(plan_id: &str) -> Result<(), AppError> {
    if plan_id.is_empty()
        || plan_id.contains('/')
        || plan_id.contains('\\')
        || plan_id.contains("..")
    {
        return Err(AppError::Workspace("invalid plan id".into()));
    }
    Ok(())
}

fn load_meta(workspace_root: &Path, plan_id: &str) -> Result<PlanMeta, AppError> {
    validate_plan_id(plan_id)?;
    let path = plan_meta_path(workspace_root, plan_id);
    let text = fs::read_to_string(&path).map_err(|e| AppError::Io(e.to_string()))?;
    serde_json::from_str(&text).map_err(|e| AppError::Config(e.to_string()))
}

fn save_meta(workspace_root: &Path, meta: &PlanMeta) -> Result<(), AppError> {
    validate_plan_id(&meta.id)?;
    let path = plan_meta_path(workspace_root, &meta.id);
    let text =
        serde_json::to_string_pretty(meta).map_err(|e| AppError::Config(e.to_string()))?;
    write_atomic(&path, text.as_bytes())
}

pub fn write_plan_file_inner(
    workspace_root: &Path,
    req: WritePlanFileRequest,
) -> Result<PlanDocument, AppError> {
    let plan_id = req
        .plan_id
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_plan_id(&plan_id)?;

    let rel_path = format!(".idepus/plans/{plan_id}.md");
    let now = now_secs();
    let meta = PlanMeta {
        id: plan_id.clone(),
        path: rel_path,
        title: req.title,
        status: PlanStatus::Draft,
        created_at: now,
        updated_at: now,
        run_id: req.run_id,
        implement_run_id: None,
        session_id: req.session_id,
    };

    fs::create_dir_all(plans_dir(workspace_root)).map_err(|e| AppError::Io(e.to_string()))?;
    write_atomic(
        &plan_md_path(workspace_root, &plan_id),
        req.content.as_bytes(),
    )?;
    save_meta(workspace_root, &meta)?;

    Ok(PlanDocument {
        meta,
        content: req.content,
    })
}

#[tauri::command]
pub fn write_plan_file(
    state: State<'_, WorkspaceState>,
    req: WritePlanFileRequest,
) -> Result<PlanDocument, AppError> {
    let root = workspace_root(&state)?;
    write_plan_file_inner(&root, req)
}

#[tauri::command]
pub fn read_plan(
    state: State<'_, WorkspaceState>,
    req: ReadPlanRequest,
) -> Result<PlanDocument, AppError> {
    let root = workspace_root(&state)?;
    validate_plan_id(&req.plan_id)?;
    let meta = load_meta(&root, &req.plan_id)?;
    let content = fs::read_to_string(plan_md_path(&root, &req.plan_id))
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(PlanDocument { meta, content })
}

#[tauri::command]
pub fn write_plan(
    state: State<'_, WorkspaceState>,
    req: WritePlanRequest,
) -> Result<PlanMeta, AppError> {
    let root = workspace_root(&state)?;
    validate_plan_id(&req.plan_id)?;
    let mut meta = load_meta(&root, &req.plan_id)?;
    if let Some(title) = req.title {
        meta.title = title;
    }
    if let Some(status) = req.status {
        meta.status = status;
    }
    if let Some(run_id) = req.implement_run_id {
        meta.implement_run_id = Some(run_id);
    }
    meta.updated_at = now_secs();
    write_atomic(
        &plan_md_path(&root, &req.plan_id),
        req.content.as_bytes(),
    )?;
    save_meta(&root, &meta)?;
    Ok(meta)
}

#[tauri::command]
pub fn update_plan_status(
    state: State<'_, WorkspaceState>,
    req: UpdatePlanStatusRequest,
) -> Result<PlanMeta, AppError> {
    let root = workspace_root(&state)?;
    validate_plan_id(&req.plan_id)?;
    let mut meta = load_meta(&root, &req.plan_id)?;
    meta.status = req.status;
    if let Some(run_id) = req.implement_run_id {
        meta.implement_run_id = Some(run_id);
    }
    meta.updated_at = now_secs();
    save_meta(&root, &meta)?;
    Ok(meta)
}

#[tauri::command]
pub fn list_plans(state: State<'_, WorkspaceState>) -> Result<Vec<PlanMeta>, AppError> {
    let root = workspace_root(&state)?;
    let dir = plans_dir(&root);
    if !dir.is_dir() {
        return Ok(vec![]);
    }

    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| AppError::Io(e.to_string()))? {
        let entry = entry.map_err(|e| AppError::Io(e.to_string()))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(&path).map_err(|e| AppError::Io(e.to_string()))?;
        if let Ok(meta) = serde_json::from_str::<PlanMeta>(&text) {
            out.push(meta);
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_and_read_plan_roundtrip() {
        let dir = std::env::temp_dir().join("idepus-plan-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let doc = write_plan_file_inner(
            &dir,
            WritePlanFileRequest {
                title: "Auth refactor".into(),
                content: "# Plan: Auth\n- [ ] step 1\n".into(),
                plan_id: Some("test-plan-1".into()),
                run_id: Some("run-1".into()),
                session_id: None,
            },
        )
        .unwrap();

        assert_eq!(doc.meta.title, "Auth refactor");
        assert!(doc.content.contains("step 1"));

        let meta_path = dir.join(".idepus/plans/test-plan-1.json");
        assert!(meta_path.is_file());

        let _ = fs::remove_dir_all(&dir);
    }
}
