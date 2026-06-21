use std::fs;
use std::path::Path;
use std::process::Command;

use idepus_diff::{apply_hunks, resolve_patch, PatchHunk};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::bridge::jail::resolve_in_workspace;
use crate::bridge::search_stub::truncate_tool_json;
use crate::research;
use crate::commands::file::write_atomic;
use crate::error::AppError;
use crate::shadow::EphemeralVerifyParams;
use crate::shadow::ShadowState;
use crate::workspace::grep::grep_workspace;
use crate::workspace::ignore::build_gitignore;
use crate::workspace::FileEntry;

#[derive(Debug, Deserialize)]
pub struct ToolRequest {
    pub workspace_root: String,
    pub args: Value,
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub path: String,
    pub snippet: String,
    pub score: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
}

pub fn execute_tool(tool_name: &str, request: ToolRequest) -> Result<Value, AppError> {
    let root = Path::new(&request.workspace_root);
    if !root.is_dir() {
        return Err(AppError::Workspace(format!(
            "workspace_root is not a directory: {}",
            request.workspace_root
        )));
    }

    match tool_name {
        "read_file" => tool_read_file(root, &request.args),
        "list_dir" => tool_list_dir(root, &request.args),
        "search_codebase" => tool_search_codebase(root, &request.args),
        "grep" => tool_grep(root, &request.args),
        "parse_patch" => tool_parse_patch(&request.args),
        "apply_patch" => tool_apply_patch(root, &request.args),
        "run_linter" => tool_run_linter(root, &request.args),
        "shadow_verify" => tool_shadow_verify(root, &request.args),
        "write_plan_file" => tool_write_plan_file(root, &request.args),
        "create_file" => tool_create_file(root, &request.args),
        "delete_path" => tool_delete_path(root, &request.args),
        "web_search" => research::tool_web_search(&request.args),
        "fetch_url" => research::tool_fetch_url(&request.args),
        other => Err(AppError::Workspace(format!("unknown tool: {other}"))),
    }
}

fn tool_read_file(workspace_root: &Path, args: &Value) -> Result<Value, AppError> {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Workspace("read_file: missing path".into()))?;
    let resolved = resolve_in_workspace(workspace_root, path)?;
    let content = fs::read_to_string(&resolved).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(json!({ "content": content, "path": path }))
}

fn tool_list_dir(workspace_root: &Path, args: &Value) -> Result<Value, AppError> {
    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let recursive = args
        .get("recursive")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let target = resolve_in_workspace(workspace_root, path)?;
    let mut entries = Vec::new();
    collect_list_entries(&target, workspace_root, recursive, &mut entries)?;
    Ok(json!({ "entries": entries }))
}

fn collect_list_entries(
    dir: &Path,
    workspace_root: &Path,
    recursive: bool,
    out: &mut Vec<FileEntry>,
) -> Result<(), AppError> {
    for entry in fs::read_dir(dir).map_err(|e| AppError::Io(e.to_string()))? {
        let entry = entry.map_err(|e| AppError::Io(e.to_string()))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = path.is_dir();
        let rel = path
            .strip_prefix(workspace_root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        out.push(FileEntry {
            name,
            path: rel,
            is_dir,
        });
        if recursive && is_dir {
            collect_list_entries(&path, workspace_root, true, out)?;
        }
    }
    Ok(())
}

fn tool_search_codebase(workspace_root: &Path, args: &Value) -> Result<Value, AppError> {
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Workspace("search_codebase: missing query".into()))?;
    let max_hits = args
        .get("max_hits")
        .or_else(|| args.get("limit"))
        .and_then(|v| v.as_u64())
        .unwrap_or(10) as usize;
    let path_filter = args.get("path_filter").and_then(|v| v.as_str());

    let mut results = idepus_indexer::search_codebase(workspace_root, query, max_hits);
    if let Some(filter) = path_filter {
        let f = filter.to_lowercase();
        results.retain(|h| h.path.to_lowercase().contains(&f));
    }
    let hits: Vec<SearchHit> = results
        .into_iter()
        .map(|h| SearchHit {
            path: h.path,
            snippet: h.snippet,
            score: h.score,
            start_line: Some(h.start_line),
            end_line: Some(h.end_line),
            symbol: h.symbol,
        })
        .collect();
    let mut value = json!({ "hits": hits });
    truncate_tool_json(&mut value, 500, 8_000);
    Ok(value)
}

fn tool_grep(workspace_root: &Path, args: &Value) -> Result<Value, AppError> {
    let pattern = args
        .get("pattern")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Workspace("grep: missing pattern".into()))?;
    let path = args.get("path").and_then(|v| v.as_str());
    let glob = args.get("glob").and_then(|v| v.as_str());
    let max_hits = args
        .get("max_hits")
        .and_then(|v| v.as_u64())
        .unwrap_or(50) as usize;

    let matcher = build_gitignore(workspace_root)?;
    let hits = grep_workspace(
        workspace_root,
        &matcher,
        pattern,
        path,
        glob,
        max_hits,
    )?;
    let mut value = json!({ "hits": hits });
    truncate_tool_json(&mut value, 500, 8_000);
    Ok(value)
}

fn tool_parse_patch(args: &Value) -> Result<Value, AppError> {
    let raw = args
        .get("raw_patch")
        .or_else(|| args.get("raw_llm_output"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Patch("parse_patch: missing raw_patch".into()))?;
    let file_path = args
        .get("path")
        .or_else(|| args.get("file_path"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Patch("parse_patch: missing path".into()))?;
    let file_content = args
        .get("file_content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Patch("parse_patch: missing file_content".into()))?;
    let patch = resolve_patch(raw, file_path, file_content)
        .map_err(|e| AppError::Patch(e.to_string()))?;
    serde_json::to_value(patch).map_err(|e| AppError::Patch(e.to_string()))
}

fn tool_apply_patch(workspace_root: &Path, args: &Value) -> Result<Value, AppError> {
    if args
        .get("already_applied")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or(".");
        return Ok(json!({ "path": path, "skipped": true, "already_applied": true }));
    }

    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Patch("apply_patch: missing path".into()))?;
    let raw_patch = args.get("raw_patch").and_then(|v| v.as_str());
    let accepted_ids: Vec<String> = args
        .get("accepted_ids")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let resolved = resolve_in_workspace(workspace_root, path)?;
    let file_content = if let Some(content) = args.get("file_content").and_then(|v| v.as_str()) {
        content.to_string()
    } else {
        fs::read_to_string(&resolved).map_err(|e| AppError::Io(e.to_string()))?
    };

    let hunks: Vec<PatchHunk> = if let Some(hunks_val) = args.get("hunks") {
        serde_json::from_value(hunks_val.clone())
            .map_err(|e| AppError::Patch(format!("invalid hunks: {e}")))?
    } else if let Some(raw) = raw_patch {
        let patch = resolve_patch(raw, path, &file_content)
            .map_err(|e| AppError::Patch(e.to_string()))?;
        patch.hunks
    } else {
        return Err(AppError::Patch(
            "apply_patch: need hunks or raw_patch".into(),
        ));
    };

    let ids = if accepted_ids.is_empty() {
        hunks.iter().map(|h| h.id.clone()).collect::<Vec<_>>()
    } else {
        accepted_ids
    };

    let new_content = apply_hunks(&file_content, &hunks, &ids)
        .map_err(|e| AppError::Patch(e.to_string()))?;
    write_atomic(&resolved, new_content.as_bytes())?;
    Ok(json!({ "path": path, "applied_hunks": ids.len(), "content_length": new_content.len() }))
}

fn tool_run_linter(workspace_root: &Path, args: &Value) -> Result<Value, AppError> {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or(".");
    let _resolved = resolve_in_workspace(workspace_root, path)?;
    let output = if workspace_root.join("Cargo.toml").is_file() {
        Command::new("cargo")
            .arg("check")
            .arg("--message-format=short")
            .current_dir(workspace_root)
            .output()
    } else {
        return Ok(json!({
            "ok": true,
            "output": "linter stub: no Cargo.toml in workspace",
            "skipped": true
        }));
    };

    match output {
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let combined = format!("{stdout}\n{stderr}");
            Ok(json!({
                "ok": out.status.success(),
                "output": combined.trim(),
                "skipped": false
            }))
        }
        Err(err) => Ok(json!({
            "ok": false,
            "output": err.to_string(),
            "skipped": true
        })),
    }
}

fn tool_shadow_verify(workspace_root: &Path, args: &Value) -> Result<Value, AppError> {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Shadow("shadow_verify: missing path".into()))?;
    let raw_patch = args
        .get("raw_patch")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Shadow("shadow_verify: missing raw_patch".into()))?;
    let file_content = args
        .get("file_content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Shadow("shadow_verify: missing file_content".into()))?;

    let command = args.get("command").and_then(|v| v.as_str());
    let cmd_args: Option<Vec<String>> = args.get("args").and_then(|v| {
        v.as_array().map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect()
        })
    });
    let timeout_secs = args
        .get("timeout_secs")
        .and_then(|v| v.as_u64());

    let workspace_id = workspace_root
        .to_string_lossy()
        .replace('/', "_");

    let result = ShadowState::verify_ephemeral(EphemeralVerifyParams {
        workspace_root,
        workspace_id: &workspace_id,
        path,
        raw_patch,
        file_content,
        command,
        args: cmd_args.as_deref(),
        timeout_secs,
    })?;

    Ok(json!({
        "ok": result.passed,
        "passed": result.passed,
        "exit_code": result.exit_code,
        "stderr_summary": result.stderr_summary,
        "skipped": result.skipped,
        "output_lines": result.output_lines,
    }))
}

fn is_protected_delete(target: &Path, root: &Path) -> bool {
    if target == root {
        return true;
    }
    target
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n == ".git" || n == ".idepus")
        .unwrap_or(false)
}

fn tool_create_file(workspace_root: &Path, args: &Value) -> Result<Value, AppError> {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Workspace("create_file: missing path".into()))?;
    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let resolved = resolve_in_workspace(workspace_root, path)?;
    if resolved.exists() {
        return Err(AppError::Io(format!("file already exists: {path}")));
    }
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Io(e.to_string()))?;
    }
    write_atomic(&resolved, content.as_bytes())?;
    Ok(json!({ "path": path, "created": true }))
}

fn tool_delete_path(workspace_root: &Path, args: &Value) -> Result<Value, AppError> {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Workspace("delete_path: missing path".into()))?;
    let recursive = args
        .get("recursive")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let resolved = resolve_in_workspace(workspace_root, path)?;
    if !resolved.exists() {
        return Err(AppError::NotFound(path.to_string()));
    }
    if is_protected_delete(&resolved, workspace_root) {
        return Err(AppError::PermissionDenied(format!(
            "cannot delete protected path: {path}"
        )));
    }
    if resolved.is_dir() {
        if recursive {
            fs::remove_dir_all(&resolved).map_err(|e| AppError::Io(e.to_string()))?;
        } else {
            fs::remove_dir(&resolved).map_err(|e| AppError::Io(e.to_string()))?;
        }
    } else {
        fs::remove_file(&resolved).map_err(|e| AppError::Io(e.to_string()))?;
    }
    Ok(json!({ "path": path, "deleted": true }))
}

fn tool_write_plan_file(workspace_root: &Path, args: &Value) -> Result<Value, AppError> {
    use crate::commands::plan::{write_plan_file_inner, WritePlanFileRequest};

    let title = args
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Workspace("write_plan_file: missing title".into()))?;
    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Workspace("write_plan_file: missing content".into()))?;

    let doc = write_plan_file_inner(
        workspace_root,
        WritePlanFileRequest {
            title: title.to_string(),
            content: content.to_string(),
            plan_id: args
                .get("plan_id")
                .and_then(|v| v.as_str())
                .map(String::from),
            run_id: args
                .get("run_id")
                .and_then(|v| v.as_str())
                .map(String::from),
            session_id: args
                .get("session_id")
                .and_then(|v| v.as_str())
                .map(String::from),
        },
    )?;

    serde_json::to_value(doc).map_err(|e| AppError::Config(e.to_string()))
}
