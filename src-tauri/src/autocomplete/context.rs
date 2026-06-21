const MAX_CONTEXT_CHARS: usize = 4096;
const LINE_WINDOW: usize = 30;

/// Restrict prefix/suffix to cursor ±30 lines and ~1024 token char budget.
pub fn lite_context(prefix: &str, suffix: &str, cursor_offset: usize) -> (String, String) {
    let combined = format!("{prefix}{suffix}");
    if cursor_offset > combined.len() {
        return (truncate_chars(prefix, MAX_CONTEXT_CHARS / 2), truncate_chars(suffix, MAX_CONTEXT_CHARS / 2));
    }

    let before = &combined[..cursor_offset];
    let _after = &combined[cursor_offset..];

    let line_before = before.matches('\n').count();
    let all_lines: Vec<&str> = combined.split('\n').collect();
    let start_line = line_before.saturating_sub(LINE_WINDOW);
    let end_line = (line_before + LINE_WINDOW + 1).min(all_lines.len());

    let window = all_lines[start_line..end_line].join("\n");
    let cursor_in_window = before.len()
        .saturating_sub(all_lines[..start_line].iter().map(|l| l.len() + 1).sum::<usize>());

    let win_prefix = window.get(..cursor_in_window.min(window.len())).unwrap_or("");
    let win_suffix = window.get(cursor_in_window.min(window.len())..).unwrap_or("");

    let half = MAX_CONTEXT_CHARS / 2;
    (
        truncate_chars(win_prefix, half),
        truncate_chars(win_suffix, half),
    )
}

fn truncate_chars(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    text.chars().rev().take(max).collect::<String>().chars().rev().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lite_context_limits_window() {
        let lines: Vec<String> = (0..100).map(|i| format!("line {i}")).collect();
        let doc = lines.join("\n");
        let cursor = doc.find("line 50").unwrap() + "line 50".len();
        let (p, s) = lite_context(&doc[..cursor], &doc[cursor..], cursor);
        assert!(p.contains("line 50") || s.contains("line 50"));
        assert!(p.len() + s.len() <= MAX_CONTEXT_CHARS + 64);
    }
}
