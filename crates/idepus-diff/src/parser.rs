use regex::Regex;
use uuid::Uuid;

use crate::error::PatchError;
use crate::protected::{check_hunk_protected, find_protected_ranges};
use crate::types::{Patch, PatchHunk, RawHunk};

const SEARCH_MARKER: &str = "<<<<<<< SEARCH";
const DIVIDER: &str = "=======";
const REPLACE_MARKER: &str = ">>>>>>> REPLACE";

pub fn strip_markdown_fences(raw: &str) -> String {
    let trimmed = raw.trim();
    let re = Regex::new(r"(?s)^```(?:\w+)?\s*\n?(.*?)\n?```\s*$").unwrap();
    if let Some(caps) = re.captures(trimmed) {
        return caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_else(|| trimmed.to_string());
    }
    trimmed.to_string()
}

pub fn parse_raw_blocks(raw: &str) -> Result<Vec<RawHunk>, PatchError> {
    let normalized = strip_markdown_fences(raw);
    if !normalized.contains(SEARCH_MARKER) {
        return Err(PatchError::EmptyPatch);
    }

    let mut hunks = Vec::new();
    let mut rest = normalized.as_str();

    while let Some(search_idx) = rest.find(SEARCH_MARKER) {
        rest = &rest[search_idx + SEARCH_MARKER.len()..];
        rest = rest.strip_prefix('\n').unwrap_or(rest);

        let divider_idx = rest
            .find(DIVIDER)
            .ok_or_else(|| PatchError::InvalidFormat("missing =======".into()))?;
        let search_text = rest[..divider_idx].trim_end_matches('\n').to_string();

        rest = &rest[divider_idx + DIVIDER.len()..];
        rest = rest.strip_prefix('\n').unwrap_or(rest);

        let replace_idx = rest
            .find(REPLACE_MARKER)
            .ok_or_else(|| PatchError::InvalidFormat("missing >>>>>>> REPLACE".into()))?;
        let replace_text = rest[..replace_idx].trim_end_matches('\n').to_string();

        hunks.push(RawHunk {
            search_text,
            replace_text,
        });

        rest = &rest[replace_idx + REPLACE_MARKER.len()..];
        rest = rest.strip_prefix('\n').unwrap_or(rest);
    }

    if hunks.is_empty() {
        return Err(PatchError::EmptyPatch);
    }

    Ok(hunks)
}

pub fn resolve_patch(
    raw: &str,
    file_path: &str,
    file_content: &str,
) -> Result<Patch, PatchError> {
    let raw_hunks = parse_raw_blocks(raw)?;
    let protected = find_protected_ranges(file_content);
    let mut resolved = Vec::new();
    let mut occupied: Vec<(usize, usize)> = Vec::new();

    for (block_index, raw_hunk) in raw_hunks.iter().enumerate() {
        idepus_context::validate_hunk_coherence(&raw_hunk.search_text, &raw_hunk.replace_text)
            .map_err(PatchError::InvalidFormat)?;

        let (start_byte, end_byte) = if idepus_context::is_greenfield_search(&raw_hunk.search_text) {
            (0, file_content.len())
        } else {
            let start_byte = file_content
                .find(&raw_hunk.search_text)
                .ok_or(PatchError::NoMatch { block_index })?;
            let end_byte = start_byte + raw_hunk.search_text.len();
            (start_byte, end_byte)
        };

        for &(o_start, o_end) in &occupied {
            if ranges_overlap(start_byte, end_byte, o_start, o_end) {
                return Err(PatchError::Overlap { byte: start_byte });
            }
        }
        occupied.push((start_byte, end_byte));

        check_hunk_protected(start_byte, end_byte, &protected)?;

        let (start_line, end_line) = byte_range_to_lines(file_content, start_byte, end_byte);

        resolved.push(PatchHunk {
            id: Uuid::new_v4().to_string(),
            start_byte,
            end_byte,
            start_line,
            end_line,
            search_text: raw_hunk.search_text.clone(),
            replace_text: raw_hunk.replace_text.clone(),
        });
    }

    Ok(Patch {
        patch_id: Uuid::new_v4().to_string(),
        path: file_path.to_string(),
        hunks: resolved,
    })
}

fn ranges_overlap(a_start: usize, a_end: usize, b_start: usize, b_end: usize) -> bool {
    a_start < b_end && b_start < a_end
}

fn byte_range_to_lines(content: &str, start_byte: usize, end_byte: usize) -> (u32, u32) {
    let start_line = content[..start_byte].bytes().filter(|&b| b == b'\n').count() as u32 + 1;
    let end_line = content[..end_byte].bytes().filter(|&b| b == b'\n').count() as u32 + 1;
    (start_line, end_line)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_block() {
        let raw = r"<<<<<<< SEARCH
fn old() {}
=======
fn new() {}
>>>>>>> REPLACE";
        let hunks = parse_raw_blocks(raw).unwrap();
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].search_text, "fn old() {}");
        assert_eq!(hunks[0].replace_text, "fn new() {}");
    }

    #[test]
    fn rejects_plain_rewrite() {
        let err = parse_raw_blocks("fn entire_file() {}").unwrap_err();
        assert_eq!(err, PatchError::EmptyPatch);
    }

    #[test]
    fn resolves_positions_in_file() {
        let content = "line1\nfn old() {}\nline3\n";
        let raw = r"<<<<<<< SEARCH
fn old() {}
=======
fn new() {}
>>>>>>> REPLACE";
        let patch = resolve_patch(raw, "a.rs", content).unwrap();
        assert_eq!(patch.hunks.len(), 1);
        assert_eq!(patch.hunks[0].start_line, 2);
    }
}
