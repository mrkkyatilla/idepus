mod apply;
pub mod prepare;
mod types;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub use types::{CommandResult, EphemeralVerifyParams, ShadowPrepareResult, ShadowResultPayload};

use crate::error::AppError;
use crate::shadow::apply::apply_patch_to_shadow;
use crate::shadow::prepare::{discard_tree, prepare_tree, shadow_root_for_workspace};
use crate::shadow::types::ShadowMeta;
use crate::terminal::runner::run_command_auto;

const SHADOW_TTL: Duration = Duration::from_secs(30 * 60);

pub struct ShadowState {
    sessions: Mutex<HashMap<String, ShadowMeta>>,
}

impl ShadowState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn purge_expired(&self) {
        let mut sessions = self.sessions.lock().expect("shadow lock");
        let now = Instant::now();
        let expired: Vec<String> = sessions
            .iter()
            .filter(|(_, meta)| now.duration_since(meta.created_at) > SHADOW_TTL)
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            if let Some(meta) = sessions.remove(&id) {
                let _ = discard_tree(&meta.shadow_root);
            }
        }
    }

    pub fn prepare(
        &self,
        workspace_id: String,
        workspace_root: String,
        _files_to_modify: Option<Vec<String>>,
    ) -> Result<ShadowPrepareResult, AppError> {
        self.purge_expired();

        let root = Path::new(&workspace_root);
        if !root.is_dir() {
            return Err(AppError::Shadow(format!(
                "workspace_root is not a directory: {workspace_root}"
            )));
        }

        let mut sessions = self.sessions.lock().expect("shadow lock");
        let to_remove: Vec<String> = sessions
            .iter()
            .filter(|(_, m)| m.workspace_id == workspace_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in to_remove {
            if let Some(meta) = sessions.remove(&id) {
                let _ = discard_tree(&meta.shadow_root);
            }
        }

        let shadow_id = Uuid::new_v4().to_string();
        let shadow_root = shadow_root_for_workspace(&workspace_id);
        prepare_tree(root, &shadow_root)?;

        if let Some(files) = &_files_to_modify {
            if !files.is_empty() {
                crate::shadow::prepare::ensure_shadow_files(root, &shadow_root, files)?;
            }
        }

        sessions.insert(
            shadow_id.clone(),
            ShadowMeta {
                shadow_id: shadow_id.clone(),
                workspace_id,
                workspace_root: workspace_root.clone(),
                shadow_root: shadow_root.clone(),
                created_at: Instant::now(),
            },
        );

        Ok(ShadowPrepareResult {
            shadow_id,
            shadow_root: shadow_root.to_string_lossy().into_owned(),
        })
    }

    pub fn apply_patch(
        &self,
        shadow_id: &str,
        path: &str,
        raw_patch: &str,
        file_content: &str,
    ) -> Result<(), AppError> {
        let sessions = self.sessions.lock().expect("shadow lock");
        let meta = sessions
            .get(shadow_id)
            .ok_or_else(|| AppError::Shadow(format!("unknown shadow_id: {shadow_id}")))?;
        apply_patch_to_shadow(
            Path::new(&meta.workspace_root),
            &meta.shadow_root,
            path,
            raw_patch,
            file_content,
        )?;
        Ok(())
    }

    pub fn run_command(
        &self,
        app: &AppHandle,
        shadow_id: &str,
        command: Option<String>,
        args: Option<Vec<String>>,
        timeout_secs: Option<u64>,
    ) -> Result<CommandResult, AppError> {
        let shadow_root = {
            let sessions = self.sessions.lock().expect("shadow lock");
            let meta = sessions
                .get(shadow_id)
                .ok_or_else(|| AppError::Shadow(format!("unknown shadow_id: {shadow_id}")))?;
            meta.shadow_root.clone()
        };

        let result = run_command_auto(
            &shadow_root,
            command.as_deref(),
            args.as_deref(),
            timeout_secs,
        )?;

        let payload = ShadowResultPayload {
            shadow_id: shadow_id.to_string(),
            passed: result.passed,
            exit_code: result.exit_code,
            stderr_summary: result.stderr_summary.clone(),
        };
        let app_for_emit = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = app_for_emit.emit("shadow_result", payload);
        });

        Ok(result)
    }

    pub fn discard(&self, shadow_id: &str) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().expect("shadow lock");
        if let Some(meta) = sessions.remove(shadow_id) {
            discard_tree(&meta.shadow_root)?;
        }
        Ok(())
    }

    pub fn verify_ephemeral(params: EphemeralVerifyParams<'_>) -> Result<CommandResult, AppError> {
        let shadow_root = shadow_root_for_workspace(&format!("ephemeral-{}", params.workspace_id));
        prepare_tree(params.workspace_root, &shadow_root)?;
        let result = (|| {
            crate::shadow::prepare::ensure_shadow_files(
                params.workspace_root,
                &shadow_root,
                &[params.path.to_string()],
            )?;
            apply_patch_to_shadow(
                params.workspace_root,
                &shadow_root,
                params.path,
                params.raw_patch,
                params.file_content,
            )?;
            run_command_auto(
                &shadow_root,
                params.command,
                params.args,
                params.timeout_secs,
            )
        })();
        let _ = discard_tree(&shadow_root);
        result
    }
}

impl Default for ShadowState {
    fn default() -> Self {
        Self::new()
    }
}
