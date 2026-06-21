pub mod credentials;
pub mod error;
pub mod mock;
pub mod prompt;
pub mod provider;
pub mod providers;
pub mod registry;
pub mod retry;
pub mod types;

pub use credentials::{get_api_key, has_api_key, store_api_key};
pub use error::LLMError;
pub use mock::MockProvider;
pub use prompt::{build_cmdk_messages, build_user_prompt, SYSTEM_PROMPT};
pub use provider::{CancellationToken, ChunkStream, LLMProvider};
pub use providers::{AnthropicProvider, OllamaAutocomplete, OpenAIProvider};
pub use registry::ProviderRegistry;
pub use retry::{with_retry, MAX_RETRIES};
pub use types::{
    CacheControl, CacheControlType, ChatMessage, ContentBlock, GenerateOptions, MessageRole,
    ProviderConfig, ProviderInfo, StreamChunk, StoredConfig, TaskMetadata, UsageMetrics,
};
