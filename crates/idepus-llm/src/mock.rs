use async_trait::async_trait;
use tokio::time::{Duration, sleep};

use crate::error::LLMError;
use crate::provider::{CancellationToken, ChunkStream, LLMProvider, channel_stream};
use crate::types::{ChatMessage, GenerateOptions, StreamChunk};

pub struct MockProvider {
    pub chunks: Vec<String>,
    pub fail: bool,
}

impl MockProvider {
    pub fn new(chunks: Vec<&str>) -> Self {
        Self {
            chunks: chunks.into_iter().map(str::to_string).collect(),
            fail: false,
        }
    }
}

#[async_trait]
impl LLMProvider for MockProvider {
    fn provider_id(&self) -> &str {
        "mock"
    }

    fn token_limit(&self) -> u32 {
        4096
    }

    fn supports_tools(&self) -> bool {
        false
    }

    async fn generate_stream(
        &self,
        _messages: &[ChatMessage],
        _options: &GenerateOptions,
        cancel: CancellationToken,
    ) -> Result<ChunkStream, LLMError> {
        if self.fail {
            return Err(LLMError::Provider("mock failure".into()));
        }

        let (tx, stream) = channel_stream(10);
        let chunks = self.chunks.clone();

        tokio::spawn(async move {
            for chunk in chunks {
                if cancel.is_cancelled() {
                    let _ = tx.send(Err(LLMError::Cancelled)).await;
                    return;
                }
                sleep(Duration::from_millis(1)).await;
                let _ = tx
                    .send(Ok(StreamChunk {
                        delta: chunk,
                        done: false,
                        usage: None,
                    }))
                    .await;
            }
            let _ = tx
                .send(Ok(StreamChunk {
                    delta: String::new(),
                    done: true,
                    usage: None,
                }))
                .await;
        });

        Ok(stream)
    }

    async fn test_connection(&self, _options: &GenerateOptions) -> Result<(), LLMError> {
        if self.fail {
            Err(LLMError::Provider("mock failure".into()))
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;

    #[tokio::test]
    async fn mock_streams_chunks_in_order() {
        let provider = MockProvider::new(vec!["a", "b"]);
        let stream = provider
            .generate_stream(
                &[ChatMessage::user("hi")],
                &GenerateOptions {
                    model: "mock".into(),
                    ..Default::default()
                },
                CancellationToken::new(),
            )
            .await
            .unwrap();

        let chunks: Vec<_> = stream
            .filter_map(|r| async move { r.ok() })
            .collect()
            .await;

        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].delta, "a");
        assert_eq!(chunks[1].delta, "b");
        assert!(chunks[2].done);
    }
}
