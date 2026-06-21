use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::config::read_yaml_or_json;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TeamContext {
    #[serde(default)]
    pub architecture: Vec<String>,
    #[serde(default)]
    pub protected_patterns: Vec<String>,
    #[serde(default)]
    pub preferred_libraries: Vec<String>,
}

impl TeamContext {
    #[allow(dead_code)]
    pub fn to_prompt_block(&self) -> String {
        let mut lines = Vec::new();
        for rule in &self.architecture {
            lines.push(format!("- {rule}"));
        }
        for pattern in &self.protected_patterns {
            lines.push(format!("- Protected path: {pattern}"));
        }
        for lib in &self.preferred_libraries {
            lines.push(format!("- Prefer library: {lib}"));
        }
        if lines.is_empty() {
            return String::new();
        }
        format!("[Team context]\n{}", lines.join("\n"))
    }
}

pub fn load_team_context(workspace_root: &Path) -> TeamContext {
    let yaml_path = workspace_root.join(".idepus-context");
    let json_path = workspace_root.join(".idepus-context.json");
    let path = if yaml_path.is_file() {
        yaml_path
    } else if json_path.is_file() {
        json_path
    } else {
        return TeamContext::default();
    };
    read_yaml_or_json(&path).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn missing_returns_empty() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let ctx = load_team_context(tmp.path());
        assert!(ctx.architecture.is_empty());
    }

    #[test]
    fn parses_yaml_context() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let yaml = r#"architecture:
  - "No global state"
protected_patterns:
  - "src/core/**"
"#;
        fs::write(tmp.path().join(".idepus-context"), yaml).unwrap();
        let ctx = load_team_context(tmp.path());
        assert_eq!(ctx.architecture.len(), 1);
        assert_eq!(ctx.protected_patterns.len(), 1);
        assert!(ctx.to_prompt_block().contains("No global state"));
    }
}
