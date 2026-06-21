use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures::StreamExt;
use idepus_llm::{
    CancellationToken, GenerateOptions, LLMError, ProviderRegistry,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::AppError;
use crate::llm::registry::StreamRegistry;

pub struct LlmState {
    pub registry: Mutex<ProviderRegistry>,
}

impl LlmState {
    pub fn new() -> Result<Self, AppError> {
        Ok(Self {
            registry: Mutex::new(
                ProviderRegistry::new().map_err(|e| AppError::Config(e.to_string()))?,
            ),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamRequestV2 {
    pub request_id: String,
    pub messages: Vec<idepus_llm::ChatMessage>,
    pub options: Option<GenerateOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunkPayload {
    pub request_id: String,
    pub delta: String,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<StreamUsagePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamUsagePayload {
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub cache_read_tokens: Option<u32>,
    pub cache_creation_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamErrorPayload {
    pub request_id: String,
    pub message: String,
}

const BATCH_MAX_CHARS: usize = 80;
const BATCH_MAX_MS: u64 = 50;

pub fn spawn_stream(app: AppHandle, request: StreamRequestV2) -> Result<(), AppError> {
    let registry = app.state::<StreamRegistry>();
    let cancel_rx = registry.register(request.request_id.clone());
    let cancel_token = CancellationToken::new();
    let cancel_watch = cancel_token.clone();

    tauri::async_runtime::spawn(async move {
        if cancel_rx.await.is_ok() {
            cancel_watch.cancel();
        }
    });

    let request_id = request.request_id.clone();
    let llm_state = app.state::<LlmState>();
    let provider = {
        let guard = llm_state.registry.lock().expect("llm registry lock");
        guard
            .active_provider()
            .map_err(|e| AppError::Llm(e.to_string()))?
    };
    let mut options = {
        let guard = llm_state.registry.lock().expect("llm registry lock");
        guard.active_generate_options()
    };
    if let Some(req_options) = request.options {
        if !req_options.model.is_empty() {
            options.model = req_options.model;
        }
        options.temperature = req_options.temperature.or(options.temperature);
        options.max_tokens = req_options.max_tokens.or(options.max_tokens);
    }

    tauri::async_runtime::spawn(async move {
        let stream_result = provider
            .generate_stream(&request.messages, &options, cancel_token)
            .await;

        let result = match stream_result {
            Ok(mut stream) => run_chunk_stream(app.clone(), request_id.clone(), &mut stream).await,
            Err(err) => Err(map_llm_error(err)),
        };

        if let Err(err) = result {
            if !matches!(err, AppError::StreamCancelled) {
                let app_for_err = app.clone();
                let err_msg = err.to_string();
                let rid = request_id.clone();
                let _ = app.run_on_main_thread(move || {
                    let _ = app_for_err.emit(
                        "stream_error",
                        StreamErrorPayload {
                            request_id: rid,
                            message: err_msg,
                        },
                    );
                });
            }
        }
        app.state::<StreamRegistry>().remove(&request_id);
    });

    Ok(())
}

async fn run_chunk_stream(
    app: AppHandle,
    request_id: String,
    stream: &mut idepus_llm::ChunkStream,
) -> Result<(), AppError> {
    struct Batcher {
        pending: String,
        last_flush: Instant,
    }

    impl Batcher {
        fn new() -> Self {
            Self {
                pending: String::new(),
                last_flush: Instant::now(),
            }
        }

        fn push(&mut self, text: &str) {
            self.pending.push_str(text);
        }

        fn should_flush(&self) -> bool {
            self.pending.len() >= BATCH_MAX_CHARS
                || self.last_flush.elapsed() >= Duration::from_millis(BATCH_MAX_MS)
        }

        fn take_pending(&mut self) -> String {
            self.last_flush = Instant::now();
            std::mem::take(&mut self.pending)
        }
    }

    let mut batcher = Batcher::new();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(map_llm_error)?;
        if !chunk.delta.is_empty() {
            batcher.push(&chunk.delta);
            if batcher.should_flush() {
                let out = batcher.take_pending();
                emit_chunk(&app, &request_id, &out, false, None)?;
            }
        }

        if chunk.done {
            if !batcher.pending.is_empty() {
                let out = batcher.take_pending();
                emit_chunk(&app, &request_id, &out, false, None)?;
            }
            emit_chunk(&app, &request_id, "", true, chunk.usage.as_ref())?;
            return Ok(());
        }
    }

    emit_chunk(&app, &request_id, "", true, None)?;
    Ok(())
}

fn emit_chunk(
    app: &AppHandle,
    request_id: &str,
    delta: &str,
    done: bool,
    usage: Option<&idepus_llm::UsageMetrics>,
) -> Result<(), AppError> {
    if delta.is_empty() && !done {
        return Ok(());
    }

    let payload = StreamChunkPayload {
        request_id: request_id.to_string(),
        delta: delta.to_string(),
        done,
        usage: usage.map(|u| StreamUsagePayload {
            prompt_tokens: u.input_tokens,
            completion_tokens: u.output_tokens,
            total_tokens: match (u.input_tokens, u.output_tokens) {
                (Some(i), Some(o)) => Some(i + o),
                _ => None,
            },
            cache_read_tokens: u.cache_read_tokens,
            cache_creation_tokens: u.cache_creation_tokens,
        }),
    };

    let app_for_emit = app.clone();
    app.run_on_main_thread(move || {
        let _ = app_for_emit.emit("stream_chunk", payload);
    })
    .map_err(|e| AppError::Llm(e.to_string()))?;

    Ok(())
}

fn map_llm_error(err: LLMError) -> AppError {
    match err {
        LLMError::Cancelled => AppError::StreamCancelled,
        other => AppError::Llm(other.to_string()),
    }
}

pub fn cancel_stream(app: &AppHandle, request_id: &str) {
    app.state::<StreamRegistry>().cancel(request_id);
}
