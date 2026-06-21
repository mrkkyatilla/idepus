use crate::error::PatchError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtectedRange {
    pub start_byte: usize,
    pub end_byte: usize,
    pub start_line: u32,
    pub end_line: u32,
}

/// Find line ranges marked with `// @ai-ignore` or `// @locked`.
pub fn find_protected_ranges(content: &str) -> Vec<ProtectedRange> {
    let mut ranges = Vec::new();
    let mut line_start = 0usize;
    for (line_num, line) in (1u32..).zip(content.split_inclusive('\n')) {
        let trimmed = line.trim();
        if trimmed.contains("@ai-ignore") || trimmed.contains("@locked") {
            let end_byte = line_start + line.len();
            ranges.push(ProtectedRange {
                start_byte: line_start,
                end_byte,
                start_line: line_num,
                end_line: line_num,
            });
        }
        line_start += line.len();
    }

    ranges
}

pub fn check_hunk_protected(
    start_byte: usize,
    end_byte: usize,
    protected: &[ProtectedRange],
) -> Result<(), PatchError> {
    for zone in protected {
        if ranges_overlap(start_byte, end_byte, zone.start_byte, zone.end_byte) {
            return Err(PatchError::ProtectedZone {
                start_line: zone.start_line,
                end_line: zone.end_line,
            });
        }
    }
    Ok(())
}

fn ranges_overlap(a_start: usize, a_end: usize, b_start: usize, b_end: usize) -> bool {
    a_start < b_end && b_start < a_end
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_ai_ignore_line() {
        let content = "fn ok() {}\n// @ai-ignore\nsecret();\n";
        let ranges = find_protected_ranges(content);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].start_line, 2);
    }

    #[test]
    fn rejects_patch_in_protected_zone() {
        let content = "a\n// @ai-ignore\nb\n";
        let protected = find_protected_ranges(content);
        let err = check_hunk_protected(0, content.len(), &protected).unwrap_err();
        assert!(matches!(err, PatchError::ProtectedZone { .. }));
    }
}
