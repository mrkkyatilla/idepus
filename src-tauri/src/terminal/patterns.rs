use regex::Regex;

use crate::terminal::types::ErrorPattern;

pub fn scan_lines(lines: &[String]) -> Vec<ErrorPattern> {
    let mut patterns = Vec::new();
    let rust_error = Regex::new(r"^error\[E\d+\]:\s*(.+)$").unwrap();
    let rust_loc = Regex::new(r"^\s*-->\s+([^:\s]+):(\d+):\d+").unwrap();
    let ts_error = Regex::new(r"^error TS\d+:\s*(.+)$").unwrap();
    let ts_loc = Regex::new(r"^(.+\.(?:ts|tsx|js|jsx)):(\d+):\d+").unwrap();
    let generic_error = Regex::new(r"^(?:Error|error):\s*(.+)$").unwrap();

    let mut pending_message: Option<String> = None;

    for line in lines {
        let trimmed = line.trim();

        if let Some(caps) = rust_error.captures(trimmed) {
            pending_message = Some(caps[1].to_string());
            continue;
        }

        if let Some(caps) = rust_loc.captures(trimmed) {
            patterns.push(ErrorPattern {
                kind: "rust".into(),
                file: Some(caps[1].to_string()),
                line: caps[2].parse().ok(),
                message: pending_message.take().unwrap_or_else(|| trimmed.to_string()),
            });
            continue;
        }

        if let Some(caps) = ts_error.captures(trimmed) {
            patterns.push(ErrorPattern {
                kind: "typescript".into(),
                file: None,
                line: None,
                message: caps[1].to_string(),
            });
            continue;
        }

        if let Some(caps) = ts_loc.captures(trimmed) {
            patterns.push(ErrorPattern {
                kind: "typescript".into(),
                file: Some(caps[1].to_string()),
                line: caps[2].parse().ok(),
                message: trimmed.to_string(),
            });
            continue;
        }

        if let Some(caps) = generic_error.captures(trimmed) {
            patterns.push(ErrorPattern {
                kind: "generic".into(),
                file: None,
                line: None,
                message: caps[1].to_string(),
            });
        }
    }

    dedupe_patterns(patterns)
}

pub fn has_success_signal(lines: &[String]) -> bool {
    lines.iter().any(|line| {
        let t = line.trim();
        t.contains("Finished `") && t.contains("profile")
            || t == "    Finished"
            || t.starts_with("✓ built in")
            || t.contains("webpack compiled successfully")
    })
}

fn dedupe_patterns(mut patterns: Vec<ErrorPattern>) -> Vec<ErrorPattern> {
    patterns.sort_by(|a, b| {
        (
            a.file.as_deref().unwrap_or(""),
            a.line.unwrap_or(0),
            a.message.as_str(),
        )
            .cmp(&(
                b.file.as_deref().unwrap_or(""),
                b.line.unwrap_or(0),
                b.message.as_str(),
            ))
    });
    patterns.dedup_by(|a, b| {
        a.file == b.file && a.line == b.line && a.message == b.message
    });
    patterns.truncate(5);
    patterns
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rust_compiler_error() {
        let lines = vec![
            "error[E0425]: cannot find value `foo` in this scope".into(),
            " --> src/main.rs:12:5".into(),
        ];
        let patterns = scan_lines(&lines);
        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, "rust");
        assert_eq!(patterns[0].file.as_deref(), Some("src/main.rs"));
        assert_eq!(patterns[0].line, Some(12));
    }

    #[test]
    fn parses_typescript_error() {
        let lines = vec![
            "src/app.ts:10:3 - error TS2304: Cannot find name 'x'.".into(),
        ];
        let patterns = scan_lines(&lines);
        assert!(!patterns.is_empty());
        assert_eq!(patterns[0].kind, "typescript");
    }
}
