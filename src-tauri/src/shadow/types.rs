use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShadowPrepareResult {
    pub shadow_id: String,
    pub shadow_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult {
    pub exit_code: i32,
    pub passed: bool,
    pub output_lines: Vec<String>,
    pub stderr_summary: String,
    pub skipped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShadowResultPayload {
    pub shadow_id: String,
    pub passed: bool,
    pub exit_code: i32,
    pub stderr_summary: String,
}

#[derive(Debug, Clone)]
pub struct EphemeralVerifyParams<'a> {
    pub workspace_root: &'a Path,
    pub workspace_id: &'a str,
    pub path: &'a str,
    pub raw_patch: &'a str,
    pub file_content: &'a str,
    pub command: Option<&'a str>,
    pub args: Option<&'a [String]>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct ShadowMeta {
    #[allow(dead_code)]
    pub shadow_id: String,
    pub workspace_id: String,
    pub workspace_root: String,
    pub shadow_root: std::path::PathBuf,
    pub created_at: std::time::Instant,
}
