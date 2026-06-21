use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use futures::Stream;
use tokio::sync::mpsc;

use crate::error::LLMError;
use crate::types::{ChatMessage, GenerateOptions, StreamChunk};

pub type ChunkStream = Pin<Box<dyn Stream<Item = Result<StreamChunk, LLMError>> + Send>>;

#[derive(Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[async_trait]
pub trait LLMProvider: Send + Sync {
    fn provider_id(&self) -> &str;
    fn token_limit(&self) -> u32;
    fn supports_tools(&self) -> bool;
    async fn generate_stream(
        &self,
        messages: &[ChatMessage],
        options: &GenerateOptions,
        cancel: CancellationToken,
    ) -> Result<ChunkStream, LLMError>;

    async fn test_connection(&self, options: &GenerateOptions) -> Result<(), LLMError>;
}

pub fn channel_stream(
    cap: usize,
) -> (
    mpsc::Sender<Result<StreamChunk, LLMError>>,
    ChunkStream,
) {
    let (tx, rx) = mpsc::channel(cap);
    let stream = Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx));
    (tx, stream)
}
