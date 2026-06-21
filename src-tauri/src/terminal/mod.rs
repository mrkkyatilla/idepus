mod buffer;
mod patterns;
pub mod runner;
mod session;
mod types;

use std::collections::HashMap;
use std::sync::Mutex;

pub use session::{spawn_session, validate_cwd, SessionMeta};
pub use types::{TerminalContext, TerminalCreateResult};

use crate::error::AppError;
use crate::terminal::patterns::scan_lines;

pub struct TerminalState {
    sessions: Mutex<HashMap<String, SessionMeta>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn create(
        &self,
        app: tauri::AppHandle,
        cwd: String,
        cols: u16,
        rows: u16,
    ) -> Result<TerminalCreateResult, AppError> {
        validate_cwd(&cwd)?;
        let session = spawn_session(app, cwd, cols, rows)?;
        let session_id = session.session_id.clone();
        self.sessions
            .lock()
            .expect("terminal lock")
            .insert(session_id.clone(), session);
        Ok(TerminalCreateResult { session_id })
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), AppError> {
        let sessions = self.sessions.lock().expect("terminal lock");
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Terminal(format!("unknown session: {session_id}")))?;
        session.write(data)
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let sessions = self.sessions.lock().expect("terminal lock");
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Terminal(format!("unknown session: {session_id}")))?;
        session.resize(cols, rows)
    }

    pub fn destroy(&self, session_id: &str) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().expect("terminal lock");
        if let Some(session) = sessions.remove(session_id) {
            session.shutdown();
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub fn destroy_all(&self) {
        let mut sessions = self.sessions.lock().expect("terminal lock");
        for (_, session) in sessions.drain() {
            session.shutdown();
        }
    }

    pub fn context(
        &self,
        session_id: &str,
        line_count: Option<usize>,
    ) -> Result<TerminalContext, AppError> {
        let sessions = self.sessions.lock().expect("terminal lock");
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Terminal(format!("unknown session: {session_id}")))?;

        let count = line_count.unwrap_or(50).min(200);
        let lines = session
            .buffer
            .lock()
            .expect("buffer lock")
            .tail_lines(count);
        let patterns = session.patterns.lock().expect("patterns lock").clone();
        let patterns = if patterns.is_empty() {
            scan_lines(&lines)
        } else {
            patterns
        };

        Ok(TerminalContext {
            session_id: session_id.to_string(),
            cwd: session.cwd.clone(),
            lines,
            patterns,
        })
    }
}

impl Default for TerminalState {
    fn default() -> Self {
        Self::new()
    }
}
