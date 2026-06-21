mod anthropic;
mod ollama;
mod openai;

pub use anthropic::AnthropicProvider;
pub use ollama::OllamaAutocomplete;
pub use openai::OpenAIProvider;

pub fn parse_openai_sse_line(line: &str) -> Option<String> {
    let line = line.trim();
    if !line.starts_with("data:") {
        return None;
    }
    let data = line.trim_start_matches("data:").trim();
    if data == "[DONE]" {
        return None;
    }
    let json: serde_json::Value = serde_json::from_str(data).ok()?;
    json["choices"][0]["delta"]["content"]
        .as_str()
        .map(str::to_string)
}

pub fn parse_openai_usage(data: &str) -> Option<crate::types::UsageMetrics> {
    let json: serde_json::Value = serde_json::from_str(data).ok()?;
    let usage = json.get("usage")?;
    Some(crate::types::UsageMetrics {
        input_tokens: usage["prompt_tokens"].as_u64().map(|v| v as u32),
        output_tokens: usage["completion_tokens"].as_u64().map(|v| v as u32),
        cache_read_tokens: None,
        cache_creation_tokens: None,
    })
}

pub fn parse_anthropic_sse_line(line: &str) -> Option<String> {
    let line = line.trim();
    if !line.starts_with("data:") {
        return None;
    }
    let data = line.trim_start_matches("data:").trim();
    let json: serde_json::Value = serde_json::from_str(data).ok()?;
    if json["type"].as_str()? == "content_block_delta" {
        return json["delta"]["text"].as_str().map(str::to_string);
    }
    None
}

pub fn parse_anthropic_usage(data: &str) -> Option<crate::types::UsageMetrics> {
    let json: serde_json::Value = serde_json::from_str(data).ok()?;
    if json["type"].as_str()? != "message_delta" {
        return None;
    }
    let usage = json.get("usage")?;
    Some(crate::types::UsageMetrics {
        input_tokens: usage["input_tokens"].as_u64().map(|v| v as u32),
        output_tokens: usage["output_tokens"].as_u64().map(|v| v as u32),
        cache_read_tokens: usage["cache_read_input_tokens"].as_u64().map(|v| v as u32),
        cache_creation_tokens: usage["cache_creation_input_tokens"]
            .as_u64()
            .map(|v| v as u32),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_sse_parses_delta() {
        let line = r#"data: {"choices":[{"delta":{"content":"fn"}}]}"#;
        assert_eq!(parse_openai_sse_line(line).as_deref(), Some("fn"));
    }

    #[test]
    fn anthropic_sse_parses_delta() {
        let line = r#"data: {"type":"content_block_delta","delta":{"text":"hello"}}"#;
        assert_eq!(parse_anthropic_sse_line(line).as_deref(), Some("hello"));
    }
}
