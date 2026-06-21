pub const SYSTEM_PROMPT: &str = "You are a code editing assistant. You MUST respond using one or more SEARCH/REPLACE blocks only:\n\n<<<<<<< SEARCH\nexact text to find (must match the file exactly)\n=======\nreplacement text\n>>>>>>> REPLACE\n\nRules:\n- Only patch the selected region; do not rewrite the entire file.\n- Use exact whitespace and indentation in SEARCH blocks.\n- No markdown fences or prose outside the blocks.";

pub fn build_user_prompt(file_path: &str, selection: &str, instruction: &str) -> String {
    format!(
        "File: {file_path}\n\nSelected code:\n```\n{selection}\n```\n\nInstruction: {instruction}"
    )
}

pub fn build_cmdk_messages(file_path: &str, selection: &str, instruction: &str) -> Vec<crate::types::ChatMessage> {
    use crate::types::ChatMessage;
    vec![
        ChatMessage::system(SYSTEM_PROMPT),
        ChatMessage::user(build_user_prompt(file_path, selection, instruction)),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_prompt_includes_selection_and_instruction() {
        let prompt = build_user_prompt("src/main.rs", "fn main() {}", "make async");
        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("fn main() {}"));
        assert!(prompt.contains("make async"));
    }
}
