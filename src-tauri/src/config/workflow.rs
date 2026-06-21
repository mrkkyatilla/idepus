use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::config::read_yaml_or_json;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkflowOverride {
    pub when: HashMap<String, String>,
    pub agent_id: Option<String>,
    pub provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkflowConfig {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub overrides: Vec<WorkflowOverride>,
}

pub fn load_workflow_config(workspace_root: &Path) -> WorkflowConfig {
    let path = workspace_root.join("ai-workflow.yaml");
    if !path.is_file() {
        return WorkflowConfig::default();
    }
    read_yaml_or_json(&path).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn missing_file_returns_default() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg = load_workflow_config(tmp.path());
        assert!(cfg.overrides.is_empty());
    }

    #[test]
    fn parses_yaml_override() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let yaml = r#"version: 1
overrides:
  - when: { task: refactor }
    agent_id: multi-file-editor
    provider: openai
"#;
        fs::write(tmp.path().join("ai-workflow.yaml"), yaml).unwrap();
        let cfg = load_workflow_config(tmp.path());
        assert_eq!(cfg.overrides.len(), 1);
        assert_eq!(
            cfg.overrides[0].agent_id.as_deref(),
            Some("multi-file-editor")
        );
    }
}
