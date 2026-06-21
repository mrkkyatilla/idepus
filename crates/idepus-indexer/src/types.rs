use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexPhase {
    /// Semantic indexer not enabled; path/grep search only.
    Unavailable,
    Idle,
    Indexing,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub phase: IndexPhase,
    pub current: u32,
    pub total: u32,
    pub ready: bool,
    pub last_updated: Option<u64>,
    pub file_count: u32,
    /// False until local semantic indexer ships.
    pub semantic_available: bool,
}

impl IndexStatus {
    pub fn deferred() -> Self {
        Self {
            phase: IndexPhase::Unavailable,
            current: 0,
            total: 0,
            ready: false,
            last_updated: None,
            file_count: 0,
            semantic_available: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub symbol: Option<String>,
    pub snippet: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MentionInput {
    pub kind: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextChunk {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBundle {
    pub chunks: Vec<ContextChunk>,
    pub estimated_tokens: u32,
}
