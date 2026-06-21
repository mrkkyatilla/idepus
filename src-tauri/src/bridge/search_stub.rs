use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::error::AppError;
use idepus_indexer::SearchResult;

#[derive(Debug, Serialize)]
pub struct StubSearchHit {
    pub path: String,
    pub snippet: String,
    pub score: f32,
}

pub fn search_workspace(root: &Path, query: &str, limit: usize) -> Vec<SearchResult> {
    let query_lower = query.to_lowercase();
    let mut hits: Vec<StubSearchHit> = Vec::new();
    let _ = walk_search(root, root, &query_lower, &mut hits, limit);
    hits.into_iter()
        .map(|h| SearchResult {
            path: h.path,
            start_line: 1,
            end_line: 1,
            symbol: None,
            snippet: h.snippet,
            score: h.score,
        })
        .collect()
}

pub fn truncate_tool_json(value: &mut serde_json::Value, max_snippet: usize, max_bytes: usize) {
    if let Some(hits) = value.get_mut("hits").and_then(|v| v.as_array_mut()) {
        for hit in hits.iter_mut() {
            if let Some(snippet) = hit.get_mut("snippet").and_then(|v| v.as_str()) {
                let truncated = truncate_str(snippet, max_snippet);
                hit["snippet"] = serde_json::Value::String(truncated);
            }
        }
    }

    loop {
        let too_big = serde_json::to_string(value).map(|s| s.len()).unwrap_or(0) > max_bytes;
        if !too_big {
            break;
        }
        let Some(hits) = value.get_mut("hits").and_then(|v| v.as_array_mut()) else {
            break;
        };
        if hits.len() <= 1 {
            break;
        }
        hits.pop();
    }
}

fn truncate_str(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    text.chars().take(max).collect::<String>() + "…"
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn truncate_tool_json_caps_payload() {
        let mut value = json!({
            "hits": (0..20).map(|i| json!({
                "path": format!("src/f{i}.rs"),
                "snippet": "x".repeat(800),
                "score": 0.5
            })).collect::<Vec<_>>()
        });
        truncate_tool_json(&mut value, 100, 1500);
        let hits = value["hits"].as_array().unwrap();
        assert!(hits.len() < 20);
        for hit in hits {
            let snippet = hit["snippet"].as_str().unwrap();
            assert!(snippet.chars().count() <= 101);
        }
    }
}

fn path_matches_search_query(rel: &str, query: &str) -> bool {
    let rel_lower = rel.to_lowercase();
    let query_lower = query.to_lowercase();
    if rel_lower.contains(&query_lower) {
        return true;
    }
    let tokens: Vec<&str> = query_lower
        .split(|c: char| !c.is_alphanumeric() && c != '.' && c != '-' && c != '/')
        .filter(|token| token.len() >= 3)
        .collect();
    if tokens.len() >= 2 {
        let matched = tokens.iter().filter(|token| rel_lower.contains(**token)).count();
        if matched >= 2 {
            return true;
        }
    }
    false
}

fn walk_search(
    workspace_root: &Path,
    dir: &Path,
    query: &str,
    hits: &mut Vec<StubSearchHit>,
    max_hits: usize,
) -> Result<(), AppError> {
    if hits.len() >= max_hits {
        return Ok(());
    }
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return Ok(()),
    };
    for entry in read_dir.flatten() {
        if hits.len() >= max_hits {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        if path.is_dir() {
            walk_search(workspace_root, &path, query, hits, max_hits)?;
        } else if path.is_file() {
            let rel = path
                .strip_prefix(workspace_root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            if path_matches_search_query(&rel, query) {
                hits.push(StubSearchHit {
                    path: rel.clone(),
                    snippet: format!("filename match: {rel}"),
                    score: 0.9,
                });
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                if content.to_lowercase().contains(query) {
                    let snippet = content
                        .lines()
                        .find(|l| l.to_lowercase().contains(query))
                        .unwrap_or("")
                        .chars()
                        .take(120)
                        .collect();
                    hits.push(StubSearchHit {
                        path: rel,
                        snippet,
                        score: 0.7,
                    });
                }
            }
        }
    }
    Ok(())
}
