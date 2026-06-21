use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("file not found: {0}")]
    NotFound(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("invalid utf-8 in file: {0}")]
    InvalidUtf8(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("llm error: {0}")]
    Llm(String),
    #[error("config error: {0}")]
    Config(String),
    #[error("stream cancelled")]
    StreamCancelled,
    #[error("workspace error: {0}")]
    Workspace(String),
    #[error("patch error: {0}")]
    Patch(String),
    #[error("watch error: {0}")]
    Watch(String),
    #[error("terminal error: {0}")]
    Terminal(String),
    #[error("shadow error: {0}")]
    Shadow(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        use std::io::ErrorKind;
        match err.kind() {
            ErrorKind::NotFound => AppError::NotFound(err.to_string()),
            ErrorKind::PermissionDenied => AppError::PermissionDenied(err.to_string()),
            _ => AppError::Io(err.to_string()),
        }
    }
}
