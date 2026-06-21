pub mod bridge;
pub mod registry;

use idepus_llm::ProviderRegistry;

use crate::error::AppError;
use crate::llm::bridge::LlmState;

pub use bridge::{cancel_stream, spawn_stream, StreamRequestV2};

pub fn registry_from_state(
    state: &LlmState,
) -> Result<std::sync::MutexGuard<'_, ProviderRegistry>, AppError> {
    state
        .registry
        .lock()
        .map_err(|_| AppError::Config("llm registry lock poisoned".into()))
}
