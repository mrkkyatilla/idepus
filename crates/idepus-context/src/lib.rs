//! Lightweight structure checks for SEARCH/REPLACE hunks.
//! Full tree-sitter symbol editing ships in Faz 11 (idepus-context expansion).

/// Greenfield patches use an empty SEARCH block.
pub fn is_greenfield_search(search: &str) -> bool {
    search.trim().is_empty()
}

/// Reject hunks that would unbalance braces/parens in a naive but useful way.
pub fn validate_hunk_coherence(search: &str, replace: &str) -> Result<(), String> {
    if is_greenfield_search(search) {
        return Ok(());
    }
    for (open, close, label) in [('{', '}', "braces"), ('(', ')', "parentheses")] {
        let s_delta = count_char(search, open) as i32 - count_char(search, close) as i32;
        let r_delta = count_char(replace, open) as i32 - count_char(replace, close) as i32;
        if s_delta != r_delta {
            return Err(format!(
                "Patch may break {label}: SEARCH delta {s_delta} vs REPLACE delta {r_delta}"
            ));
        }
    }
    Ok(())
}

fn count_char(text: &str, ch: char) -> usize {
    text.chars().filter(|c| *c == ch).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_greenfield() {
        assert!(validate_hunk_coherence("", "new file").is_ok());
    }

    #[test]
    fn rejects_unbalanced_braces() {
        let err = validate_hunk_coherence("{", "{}}").unwrap_err();
        assert!(err.contains("braces"));
    }
}
