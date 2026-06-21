use std::time::Duration;

use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;

use crate::credentials::get_api_key;
use crate::error::LLMError;
use crate::provider::{CancellationToken, ChunkStream, LLMProvider, channel_stream};
use crate::providers::{parse_openai_sse_line, parse_openai_usage};
use crate::retry::with_retry;
use crate::types::{ChatMessage, GenerateOptions, MessageRole, StreamChunk};

pub struct OpenAIProvider {
    client: Client,
}

impl OpenAIProvider {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("http client"),
        }
    }

    fn to_openai_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
        messages
            .iter()
            .map(|m| {
                let role = match m.role {
                    MessageRole::System => "system",
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                };
                serde_json::json!({ "role": role, "content": m.text() })
            })
            .collect()
    }
}

impl Default for OpenAIProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl LLMProvider for OpenAIProvider {
    fn provider_id(&self) -> &str {
        "openai"
    }

    fn token_limit(&self) -> u32 {
        128_000
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
        let api_key = get_api_key("openai")?
            .ok_or_else(|| LLMError::Config("OpenAI API key not configured".into()))?;

        let body = serde_json::json!({
            "model": options.model,
            "stream": true,
            "stream_options": { "include_usage": true },
            "messages": Self::to_openai_messages(messages),
        });

        let client = self.client.clone();
        let model = options.model.clone();

        let response = with_retry(|| {
            let client = client.clone();
            let body = body.clone();
            let api_key = api_key.clone();
            async move {
                let response = client
                    .post("https://api.openai.com/v1/chat/completions")
                    .bearer_auth(api_key)
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
                    return Err(LLMError::Provider(format!("OpenAI HTTP {status}: {text}")));
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
                        if let Some(u) = parse_openai_usage(data) {
                            usage = Some(u);
                        }
                    }

                    if let Some(delta) = parse_openai_sse_line(&line) {
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
            let _ = model;
        });

        Ok(stream)
    }

    async fn test_connection(&self, _options: &GenerateOptions) -> Result<(), LLMError> {
        let api_key = get_api_key("openai")?
            .ok_or_else(|| LLMError::Config("OpenAI API key not configured".into()))?;

        let response = self
            .client
            .get("https://api.openai.com/v1/models")
            .bearer_auth(api_key)
            .send()
            .await
            .map_err(|e| LLMError::Http(e.to_string()))?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(LLMError::Provider(format!(
                "OpenAI connection failed: HTTP {}",
                response.status()
            )))
        }
    }
}
