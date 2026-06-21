mod apply;
mod error;
mod parser;
mod protected;
mod types;

pub use apply::apply_hunks;
pub use error::PatchError;
pub use parser::{parse_raw_blocks, resolve_patch, strip_markdown_fences};
pub use protected::{find_protected_ranges, ProtectedRange};
pub use types::{Patch, PatchHunk, RawHunk};

#[cfg(test)]
mod proptest_roundtrip {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn apply_roundtrip_preserves_unpatched_prefix(
            prefix in r"[a-z]{0,20}",
            suffix in r"[a-z]{0,20}",
        ) {
            let search = "MIDDLE";
            let replace = "MID";
            let content = format!("{prefix}{search}{suffix}");
            let start = prefix.len();
            let end = start + search.len();
            let hunk = PatchHunk {
                id: "h".into(),
                start_byte: start,
                end_byte: end,
                start_line: 1,
                end_line: 1,
                search_text: search.into(),
                replace_text: replace.into(),
            };
            let out = apply_hunks(&content, &[hunk], &["h".into()]).unwrap();
            prop_assert_eq!(out, format!("{prefix}{replace}{suffix}"));
        }
    }
}
