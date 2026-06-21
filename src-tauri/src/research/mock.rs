use super::provider::{SearchResult, WebSearchProvider};
use crate::error::AppError;

pub struct MockProvider;

impl WebSearchProvider for MockProvider {
    fn search(&self, query: &str, max_results: usize) -> Result<Vec<SearchResult>, AppError> {
        let limit = max_results.max(1).min(5);
        let mut results = Vec::with_capacity(limit);
        for i in 0..limit {
            results.push(SearchResult {
                title: format!("Mock result {} for: {}", i + 1, query.chars().take(60).collect::<String>()),
                url: format!("https://example.com/mock/{i}"),
                snippet: format!(
                    "Mock snippet {} — use Tavily provider for live web search.",
                    i + 1
                ),
            });
        }
        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_returns_results() {
        let provider = MockProvider;
        let hits = provider.search("react 19", 1).expect("search");
        assert_eq!(hits.len(), 1);
        assert!(hits[0].url.contains("example.com"));
    }
}
