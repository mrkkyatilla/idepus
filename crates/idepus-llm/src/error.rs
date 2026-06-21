use thiserror::Error;

#[derive(Debug, Error)]
pub enum LLMError {
    #[error("provider error: {0}")]
    Provider(String),
    #[error("config error: {0}")]
    Config(String),
    #[error("http error: {0}")]
    Http(String),
    #[error("rate limited")]
    RateLimited,
    #[error("stream cancelled")]
    Cancelled,
    #[error("unknown provider: {0}")]
    UnknownProvider(String),
}

impl LLMError {
    pub fn is_retryable(status: reqwest::StatusCode) -> bool {
        status.as_u16() == 429 || status.is_server_error()
    }
}
