//! Shared API types for codebase search commands.
//! Semantic indexing (LanceDB / fastembed / tree-sitter) is deferred — see Faz 04 / G03 plan.
//! `structural-search` feature enables heuristic symbol-bounded chunks without vector DB.

pub mod structural;
pub mod types;

pub use types::*;

#[cfg(feature = "semantic-index")]
pub const SEMANTIC_INDEX_AVAILABLE: bool = true;

#[cfg(not(feature = "semantic-index"))]
pub const SEMANTIC_INDEX_AVAILABLE: bool = false;

/// LanceDB memory collections (`chat_memory`, `changes`) — enabled with `local-ai` feature.
pub const MEMORY_LANCE_AVAILABLE: bool = false;

/// Search workspace: structural chunks when `structural-search` is enabled, else filename stub.
pub fn search_codebase(root: &std::path::Path, query: &str, limit: usize) -> Vec<SearchResult> {
    #[cfg(feature = "structural-search")]
    {
        return structural::structural_search(root, query, limit);
    }
    #[cfg(not(feature = "structural-search"))]
    {
        let _ = (root, query, limit);
        Vec::new()
    }
}
