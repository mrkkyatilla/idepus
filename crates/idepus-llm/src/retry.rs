use std::time::Duration;

use tokio::time::sleep;

use crate::error::LLMError;

pub const MAX_RETRIES: u32 = 3;
const BACKOFF_MS: [u64; 3] = [500, 1000, 2000];

pub async fn with_retry<F, Fut, T>(mut operation: F) -> Result<T, LLMError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, LLMError>>,
{
    let mut attempt = 0u32;
    loop {
        match operation().await {
            Ok(value) => return Ok(value),
            Err(err) if is_retryable(&err) && attempt + 1 < MAX_RETRIES => {
                sleep(Duration::from_millis(BACKOFF_MS[attempt as usize])).await;
                attempt += 1;
            }
            Err(err) => return Err(err),
        }
    }
}

fn is_retryable(err: &LLMError) -> bool {
    matches!(err, LLMError::RateLimited)
        || matches!(err, LLMError::Http(msg) if msg.contains("HTTP 5"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    #[tokio::test]
    async fn retries_rate_limited_then_succeeds() {
        let calls = Arc::new(AtomicU32::new(0));
        let calls_clone = calls.clone();

        let result = with_retry(|| {
            let calls = calls_clone.clone();
            async move {
                let n = calls.fetch_add(1, Ordering::SeqCst);
                if n < 2 {
                    Err(LLMError::RateLimited)
                } else {
                    Ok("ok")
                }
            }
        })
        .await;

        assert_eq!(result.unwrap(), "ok");
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }
}
