use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalCreateResult {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutputPayload {
    pub session_id: String,
    pub data: String,
    pub is_stderr: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPattern {
    pub kind: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalErrorDetectedPayload {
    pub session_id: String,
    pub patterns: Vec<ErrorPattern>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalErrorsClearedPayload {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalContext {
    pub session_id: String,
    pub cwd: String,
    pub lines: Vec<String>,
    pub patterns: Vec<ErrorPattern>,
}
