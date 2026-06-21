use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::oneshot;

pub struct StreamRegistry {
    inner: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl StreamRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, request_id: String) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        self.inner
            .lock()
            .expect("stream registry lock")
            .insert(request_id, tx);
        rx
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        let mut guard = self.inner.lock().expect("stream registry lock");
        if let Some(tx) = guard.remove(request_id) {
            let _ = tx.send(());
            true
        } else {
            false
        }
    }

    pub fn remove(&self, request_id: &str) {
        self.inner
            .lock()
            .expect("stream registry lock")
            .remove(request_id);
    }
}

impl Default for StreamRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_removes_entry_and_signals() {
        let registry = StreamRegistry::new();
        let mut rx = registry.register("req-1".into());
        assert!(registry.cancel("req-1"));
        assert!(rx.try_recv().is_ok());
        assert!(!registry.cancel("req-1"));
    }

    #[test]
    fn remove_cleans_up_without_signal() {
        let registry = StreamRegistry::new();
        let mut rx = registry.register("req-2".into());
        registry.remove("req-2");
        assert!(rx.try_recv().is_err());
    }
}
