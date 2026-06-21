use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PatchHunk {
    pub id: String,
    pub start_byte: usize,
    pub end_byte: usize,
    pub start_line: u32,
    pub end_line: u32,
    pub search_text: String,
    pub replace_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Patch {
    pub patch_id: String,
    pub path: String,
    pub hunks: Vec<PatchHunk>,
}

#[derive(Debug, Clone)]
pub struct RawHunk {
    pub search_text: String,
    pub replace_text: String,
}
