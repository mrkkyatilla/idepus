//! Lightweight structural chunk extraction (regex/heuristic).
//! Full tree-sitter + LanceDB indexing ships behind `semantic-index` feature.

use std::fs;
use std::path::Path;

use crate::SearchResult;

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".idepus",
];

const CODE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "c", "cpp", "h", "hpp", "css", "md",
];

pub fn structural_search(root: &Path, query: &str, limit: usize) -> Vec<SearchResult> {
    let query_lower = query.to_lowercase();
    let mut hits: Vec<SearchResult> = Vec::new();
    let _ = walk_structural(root, root, &query_lower, &mut hits, limit);
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(limit);
    hits
}

fn walk_structural(
    root: &Path,
    dir: &Path,
    query_lower: &str,
    hits: &mut Vec<SearchResult>,
    limit: usize,
) -> Result<(), ()> {
    if hits.len() >= limit {
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(|_| ())?;
    for entry in entries.flatten() {
        if hits.len() >= limit {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".env.example" {
            continue;
        }
        if path.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            let _ = walk_structural(root, &path, query_lower, hits, limit);
            continue;
        }
        if !is_code_file(&path) {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        if rel.to_lowercase().contains(query_lower) {
            push_filename_hit(&rel, hits);
            if hits.len() >= limit {
                break;
            }
        }
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        scan_content_chunks(&rel, &content, query_lower, hits, limit);
    }
    Ok(())
}

fn is_code_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| CODE_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

fn push_filename_hit(path: &str, hits: &mut Vec<SearchResult>) {
    hits.push(SearchResult {
        path: path.to_string(),
        start_line: 1,
        end_line: 1,
        symbol: None,
        snippet: format!("(filename match) {path}"),
        score: 0.55,
    });
}

fn scan_content_chunks(
    path: &str,
    content: &str,
    query_lower: &str,
    hits: &mut Vec<SearchResult>,
    limit: usize,
) {
    let lines: Vec<&str> = content.lines().collect();
    for (idx, line) in lines.iter().enumerate() {
        if hits.len() >= limit {
            return;
        }
        if !line.to_lowercase().contains(query_lower) {
            continue;
        }
        let line_no = (idx + 1) as u32;
        let (start, end, symbol) = expand_symbol_block(&lines, idx);
        let snippet: String = lines[start..=end].join("\n");
        let snippet = if snippet.len() > 600 {
            format!("{}…", &snippet[..600])
        } else {
            snippet
        };
        hits.push(SearchResult {
            path: path.to_string(),
            start_line: (start + 1) as u32,
            end_line: (end + 1) as u32,
            symbol,
            snippet,
            score: 0.85,
        });
    }
}

fn expand_symbol_block(lines: &[&str], match_idx: usize) -> (usize, usize, Option<String>) {
    let mut start = match_idx;
    while start > 0 {
        let prev = lines[start - 1].trim();
        if prev.is_empty() {
            break;
        }
        if looks_like_symbol_start(prev) {
            start -= 1;
            break;
        }
        start -= 1;
    }
    let mut end = match_idx;
    while end + 1 < lines.len() {
        let next = lines[end + 1].trim();
        if next.is_empty() {
            break;
        }
        if looks_like_symbol_start(next) && end > match_idx {
            break;
        }
        end += 1;
    }
    let symbol = lines
        .get(start)
        .map(|l| l.trim())
        .filter(|l| looks_like_symbol_start(l))
        .map(|s| s.chars().take(80).collect());
    (start, end, symbol)
}

fn looks_like_symbol_start(line: &str) -> bool {
    let t = line.trim();
    t.starts_with("fn ")
        || t.starts_with("function ")
        || t.starts_with("class ")
        || t.starts_with("export function ")
        || t.starts_with("export class ")
        || t.starts_with("def ")
        || t.starts_with("pub fn ")
        || t.starts_with("async fn ")
        || t.starts_with("impl ")
        || t.starts_with("interface ")
        || t.starts_with("type ")
        || t.starts_with("const ")
        || t.starts_with("let ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn finds_structural_chunk() {
        let dir = std::env::temp_dir().join("idepus-structural-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("sample.ts");
        let mut f = fs::File::create(&file).unwrap();
        writeln!(
            f,
            "function hello() {{\n  return 'uniqueTokenXYZ';\n}}\n"
        )
        .unwrap();
        let hits = structural_search(&dir, "uniqueTokenXYZ", 5);
        assert!(!hits.is_empty());
        assert!(hits[0].start_line >= 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
