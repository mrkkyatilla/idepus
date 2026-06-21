use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PatchError {
    #[error("invalid patch format: {0}")]
    InvalidFormat(String),

    #[error("no SEARCH/REPLACE blocks found")]
    EmptyPatch,

    #[error("search block {block_index} did not match file content")]
    NoMatch { block_index: usize },

    #[error("patch hunks overlap at byte {byte}")]
    Overlap { byte: usize },

    #[error("patch intersects protected zone at lines {start_line}-{end_line}")]
    ProtectedZone {
        start_line: u32,
        end_line: u32,
    },
}
