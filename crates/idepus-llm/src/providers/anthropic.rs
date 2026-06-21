use std::time::Duration;

use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;

use crate::credentials::get_api_key;
use crate::error::LLMError;
use crate::provider::{CancellationToken, ChunkStream, LLMProvider, channel_stream};
use crate::providers::{parse_anthropic_sse_line, parse_anthropic_usage};
use crate::retry::with_retry;
use crate::types::{ChatMessage, GenerateOptions, MessageRole, StreamChunk};

pub struct AnthropicProvider {
    client: Client,
}

impl AnthropicProvider {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("http client"),
        }
    }

    fn split_messages(messages: &[ChatMessage]) -> (Option<String>, Vec<serde_json::Value>) {
        let mut system = None;
        let mut out = Vec::new();

        for m in messages {
            match m.role {
                MessageRole::System => system = Some(m.text()),
                MessageRole::User => {
                    out.push(serde_json::json!({ "role": "user", "content": m.text() }))
                }
                MessageRole::Assistant => {
                    out.push(serde_json::json!({ "role": "assistant", "content": m.text() }))
                }
            }
        }

        (system, out)
    }
}

impl Default for AnthropicProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl LLMProvider for AnthropicProvider {
    fn provider_id(&self) -> &str {
        "anthropic"
    }

    fn token_limit(&self) -> u32 {
        200_000
    }

    fn supports_tools(&self) -> bool {
        true
    }

    async fn generate_stream(
        &self,
        messages: &[ChatMessage],
        options: &GenerateOptions,
        cancel: CancellationToken,
    ) -> Result<ChunkStream, LLMError> {
        let api_key = get_api_key("anthropic")?
            .ok_or_else(|| LLMError::Config("Anthropic API key not configured".into()))?;

        let (system, api_messages) = Self::split_messages(messages);
        let max_tokens = options.max_tokens.unwrap_or(4096);

        let mut body = serde_json::json!({
            "model": options.model,
            "max_tokens": max_tokens,
            "stream": true,
            "messages": api_messages,
        });
        if let Some(sys) = system {
            body["system"] = serde_json::Value::String(sys);
        }

        let client = self.client.clone();
        let response = with_retry(|| {
            let client = client.clone();
            let body = body.clone();
            let api_key = api_key.clone();
            async move {
                let response = client
                    .post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", api_key)
                    .header("anthropic-version", "2023-06-01")
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| LLMError::Http(e.to_string()))?;

                let status = response.status();
                if !status.is_success() {
                    let text = response.text().await.unwrap_or_default();
                    if LLMError::is_retryable(status) {
                        return Err(if status.as_u16() == 429 {
                            LLMError::RateLimited
                        } else {
                            LLMError::Http(format!("HTTP {status}: {text}"))
                        });
                    }
                    return Err(LLMError::Provider(format!(
                        "Anthropic HTTP {status}: {}",
                        anthropic_error_detail(&text)
                    )));
                }
                Ok(response)
            }
        })
        .await?;

        let (tx, stream) = channel_stream(100);
        tokio::spawn(async move {
            let mut http_stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut usage = None;

            while let Some(chunk) = http_stream.next().await {
                if cancel.is_cancelled() {
                    let _ = tx.send(Err(LLMError::Cancelled)).await;
                    return;
                }

                let bytes = match chunk {
                    Ok(b) => b,
                    Err(e) => {
                        let _ = tx.send(Err(LLMError::Http(e.to_string()))).await;
                        return;
                    }
                };
                buffer.push_str(&String::from_utf8_lossy(&bytes));

                while let Some(line_end) = buffer.find('\n') {
                    let line = buffer[..line_end].trim().to_string();
                    buffer = buffer[line_end + 1..].to_string();

                    if line.starts_with("data:") {
                        let data = line.trim_start_matches("data:").trim();
                        if let Some(u) = parse_anthropic_usage(data) {
                            usage = Some(u);
                        }
                    }

                    if let Some(delta) = parse_anthropic_sse_line(&line) {
                        let _ = tx
                            .send(Ok(StreamChunk {
                                delta,
                                done: false,
                                usage: None,
                            }))
                            .await;
                    }
                }
            }

            let _ = tx
                .send(Ok(StreamChunk {
                    delta: String::new(),
                    done: true,
                    usage,
                }))
                .await;
        });

        Ok(stream)
    }

    async fn test_connection(&self, options: &GenerateOptions) -> Result<(), LLMError> {
        let api_key = get_api_key("anthropic")?
            .ok_or_else(|| LLMError::Config("Anthropic API key not configured".into()))?;

        let response = self
            .client
            .get("https://api.anthropic.com/v1/models")
            .query(&[("limit", "100")])
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .map_err(|e| LLMError::Http(e.to_string()))?;

        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        if !status.is_success() {
            let detail = anthropic_error_detail(&text);
            return Err(LLMError::Provider(format!(
                "Anthropic connection failed: HTTP {status} — {detail}"
            )));
        }

        let model = options.model.trim();
        if model.is_empty() {
            return Ok(());
        }

        let parsed: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
            LLMError::Provider(format!("Anthropic models response parse failed: {e}"))
        })?;
        let available: Vec<String> = parsed["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["id"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();

        if !available.is_empty() && !available.iter().any(|id| id == model) {
            let suggestions = available
                .iter()
                .take(3)
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            return Err(LLMError::Provider(format!(
                "Model '{model}' is not available for this API key. Try: {suggestions}"
            )));
        }

        Ok(())
    }
}

fn anthropic_error_detail(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            if body.is_empty() {
                "no response body".into()
            } else {
                body.to_string()
            }
        })
}
