use std::collections::HashSet;

use crate::error::PatchError;
use crate::types::PatchHunk;

pub fn apply_hunks(
    content: &str,
    hunks: &[PatchHunk],
    accepted_ids: &[String],
) -> Result<String, PatchError> {
    let accepted: HashSet<&str> = accepted_ids.iter().map(String::as_str).collect();
    if accepted.is_empty() {
        return Ok(content.to_string());
    }

    let mut to_apply: Vec<&PatchHunk> = hunks
        .iter()
        .filter(|h| accepted.contains(h.id.as_str()))
        .collect();

    if to_apply.is_empty() {
        return Ok(content.to_string());
    }

    // Apply from end to start so byte offsets stay valid.
    to_apply.sort_by_key(|h| std::cmp::Reverse(h.start_byte));

    let mut result = content.to_string();
    for hunk in to_apply {
        if hunk.end_byte > result.len() {
            return Err(PatchError::NoMatch { block_index: 0 });
        }
        let actual = &result[hunk.start_byte..hunk.end_byte];
        if actual != hunk.search_text {
            return Err(PatchError::NoMatch { block_index: 0 });
        }
        result.replace_range(hunk.start_byte..hunk.end_byte, &hunk.replace_text);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PatchHunk;

    fn hunk(id: &str, start: usize, end: usize, search: &str, replace: &str) -> PatchHunk {
        PatchHunk {
            id: id.into(),
            start_byte: start,
            end_byte: end,
            start_line: 1,
            end_line: 1,
            search_text: search.into(),
            replace_text: replace.into(),
        }
    }

    #[test]
    fn applies_single_hunk() {
        let content = "aaa\nbbb\nccc\n";
        let hunks = vec![hunk("h1", 4, 7, "bbb", "BBB")];
        let out = apply_hunks(content, &hunks, &["h1".into()]).unwrap();
        assert_eq!(out, "aaa\nBBB\nccc\n");
    }

    #[test]
    fn partial_acceptance() {
        let content = "one\ntwo\nthree\n";
        let hunks = vec![
            hunk("h1", 0, 3, "one", "ONE"),
            hunk("h2", 4, 7, "two", "TWO"),
        ];
        let out = apply_hunks(content, &hunks, &["h1".into()]).unwrap();
        assert_eq!(out, "ONE\ntwo\nthree\n");
    }
}
