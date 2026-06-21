use super::{AutocompleteRequest, AutocompleteSuggestion};

const MAX_SUGGESTION_LEN: usize = 120;

pub fn mock_suggest(request: &AutocompleteRequest) -> Option<AutocompleteSuggestion> {
    let raw = &request.prefix;
    let trimmed = raw.trim_end();
    if trimmed.len() < 2 {
        return None;
    }

    let text = if raw.ends_with("con") {
        "sole.log('');".to_string()
    } else if raw.ends_with("fn ") {
        "main() {}".to_string()
    } else if raw.ends_with("let ") {
        "x = 0;".to_string()
    } else if raw.ends_with("pub fn ") {
        "new() -> Self { Self }".to_string()
    } else if raw.ends_with("use ") {
        "std::collections::HashMap;".to_string()
    } else if raw.ends_with("=>") {
        " {}".to_string()
    } else if raw.ends_with("import ") {
        "{ invoke } from \"@tauri-apps/api/core\";".to_string()
    } else {
        let word = last_identifier(trimmed);
        if word.len() >= 3 {
            format!(" // complete `{word}`")
        } else {
            return None;
        }
    };

    Some(AutocompleteSuggestion {
        text: truncate(&text, MAX_SUGGESTION_LEN),
        model: "mock".into(),
        latency_ms: 1,
    })
}

fn last_identifier(prefix: &str) -> String {
    prefix
        .rsplit(|c: char| !c.is_alphanumeric() && c != '_')
        .next()
        .unwrap_or("")
        .to_string()
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    text.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(prefix: &str) -> AutocompleteRequest {
        AutocompleteRequest {
            prefix: prefix.to_string(),
            suffix: String::new(),
            file_path: "src/main.rs".into(),
            language: "rust".into(),
            cursor_offset: prefix.len(),
        }
    }

    #[test]
    fn mock_suggest_fn_prefix() {
        let out = mock_suggest(&req("fn ")).expect("suggestion");
        assert!(out.text.contains("main"));
        assert_eq!(out.model, "mock");
    }

    #[test]
    fn mock_suggest_truncates_long_output() {
        let long = "x".repeat(200);
        assert!(truncate(&long, 120).chars().count() <= 120);
    }

    #[test]
    fn mock_suggest_short_prefix_none() {
        assert!(mock_suggest(&req("a")).is_none());
    }
}
