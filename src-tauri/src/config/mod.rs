mod team_context;
mod workflow;

pub use team_context::{load_team_context, TeamContext};
pub use workflow::{load_workflow_config, WorkflowConfig};

use std::path::Path;

use crate::error::AppError;

pub fn read_yaml_or_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, AppError> {
    let text = std::fs::read_to_string(path).map_err(|e| AppError::Config(e.to_string()))?;
    if path.extension().and_then(|e| e.to_str()) == Some("json") {
        serde_json::from_str(&text).map_err(|e| AppError::Config(e.to_string()))
    } else {
        serde_yaml::from_str(&text).map_err(|e| AppError::Config(e.to_string()))
    }
}
