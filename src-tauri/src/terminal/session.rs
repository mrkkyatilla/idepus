use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::error::AppError;
use crate::terminal::buffer::LineBuffer;
use crate::terminal::patterns::{has_success_signal, scan_lines};
use crate::terminal::types::{
    ErrorPattern, TerminalErrorDetectedPayload, TerminalErrorsClearedPayload,
    TerminalOutputPayload,
};

enum SessionCommand {
    Write(String),
    Resize { cols: u16, rows: u16 },
    Shutdown,
}

pub struct SessionMeta {
    pub session_id: String,
    pub cwd: String,
    pub buffer: Arc<Mutex<LineBuffer>>,
    pub patterns: Arc<Mutex<Vec<ErrorPattern>>>,
    cmd_tx: Sender<SessionCommand>,
    thread: Option<JoinHandle<()>>,
}

impl SessionMeta {
    pub fn write(&self, data: &str) -> Result<(), AppError> {
        self.cmd_tx
            .send(SessionCommand::Write(data.to_string()))
            .map_err(|e| AppError::Terminal(e.to_string()))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        self.cmd_tx
            .send(SessionCommand::Resize { cols, rows })
            .map_err(|e| AppError::Terminal(e.to_string()))
    }

    pub fn shutdown(mut self) {
        let _ = self.cmd_tx.send(SessionCommand::Shutdown);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

pub fn spawn_session(
    app: AppHandle,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<SessionMeta, AppError> {
    let session_id = Uuid::new_v4().to_string();
    let buffer = Arc::new(Mutex::new(LineBuffer::new()));
    let patterns = Arc::new(Mutex::new(Vec::new()));
    let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Terminal(e.to_string()))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if shell.contains("bash") || shell.ends_with("/sh") {
        cmd.arg("-i");
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::Terminal(e.to_string()))?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::Terminal(e.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::Terminal(e.to_string()))?;
    let master = Arc::new(Mutex::new(pair.master));

    let app_thread = app.clone();
    let session_id_thread = session_id.clone();
    let buffer_thread = buffer.clone();
    let patterns_thread = patterns.clone();

    let write_thread = thread::spawn(move || {
        write_loop(cmd_rx, writer, master, child);
    });

    let thread = thread::spawn(move || {
        read_loop(
            app_thread,
            session_id_thread,
            reader,
            buffer_thread,
            patterns_thread,
        );
        let _ = write_thread.join();
    });

    Ok(SessionMeta {
        session_id,
        cwd,
        buffer,
        patterns,
        cmd_tx,
        thread: Some(thread),
    })
}

fn write_loop(
    cmd_rx: Receiver<SessionCommand>,
    mut writer: Box<dyn Write + Send>,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    mut child: Box<dyn portable_pty::Child + Send>,
) {
    while let Ok(cmd) = cmd_rx.recv() {
        match cmd {
            SessionCommand::Write(data) => {
                let _ = writer.write_all(data.as_bytes());
                let _ = writer.flush();
            }
            SessionCommand::Resize { cols, rows } => {
                if let Ok(guard) = master.lock() {
                    let _ = guard.resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
            }
            SessionCommand::Shutdown => {
                let _ = child.kill();
                break;
            }
        }
    }
}

fn read_loop(
    app: AppHandle,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    buffer: Arc<Mutex<LineBuffer>>,
    patterns_store: Arc<Mutex<Vec<ErrorPattern>>>,
) {
    let mut pending_output = String::new();
    let mut last_emit = Instant::now();
    let mut had_errors = false;
    let emit_interval = Duration::from_millis(16);

    loop {
        let mut read_buf = [0u8; 4096];
        let mut did_io = false;

        match reader.read(&mut read_buf) {
            Ok(0) => {}
            Ok(n) => {
                did_io = true;
                let chunk = String::from_utf8_lossy(&read_buf[..n]).to_string();
                pending_output.push_str(&chunk);
                if let Ok(mut guard) = buffer.lock() {
                    guard.append(&chunk);
                }
            }
            Err(_) => break,
        }

        if did_io || last_emit.elapsed() >= emit_interval {
            flush_output(
                &app,
                &session_id,
                &mut pending_output,
                &buffer,
                &patterns_store,
                &mut had_errors,
            );
            last_emit = Instant::now();
        }

        if !did_io {
            thread::sleep(Duration::from_millis(8));
        }
    }
}

fn flush_output(
    app: &AppHandle,
    session_id: &str,
    pending_output: &mut String,
    buffer: &Arc<Mutex<LineBuffer>>,
    patterns_store: &Arc<Mutex<Vec<ErrorPattern>>>,
    had_errors: &mut bool,
) {
    if !pending_output.is_empty() {
        let data = std::mem::take(pending_output);
        emit_terminal_output(app, session_id.to_string(), data);
    }
    update_error_state(app, session_id, buffer, patterns_store, had_errors);
}

fn emit_terminal_output(app: &AppHandle, session_id: String, data: String) {
    let app_for_emit = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = app_for_emit.emit(
            "terminal_output",
            TerminalOutputPayload {
                session_id,
                data,
                is_stderr: false,
            },
        );
    });
}

fn emit_errors_cleared(app: &AppHandle, session_id: String) {
    let app_for_emit = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = app_for_emit.emit(
            "terminal_errors_cleared",
            TerminalErrorsClearedPayload { session_id },
        );
    });
}

fn emit_error_detected(
    app: &AppHandle,
    session_id: String,
    patterns: Vec<ErrorPattern>,
) {
    let app_for_emit = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = app_for_emit.emit(
            "terminal_error_detected",
            TerminalErrorDetectedPayload {
                session_id,
                patterns,
            },
        );
    });
}

fn update_error_state(
    app: &AppHandle,
    session_id: &str,
    buffer: &Arc<Mutex<LineBuffer>>,
    patterns_store: &Arc<Mutex<Vec<ErrorPattern>>>,
    had_errors: &mut bool,
) {
    let found = {
        let guard = buffer.lock().expect("buffer lock");
        let tail = guard.tail_lines(80);
        let mut found = scan_lines(&tail);
        if found.is_empty() && has_success_signal(&tail) {
            found.clear();
        }
        found
    };

    let sid = session_id.to_string();

    if found.is_empty() {
        if *had_errors {
            *had_errors = false;
            if let Ok(mut guard) = patterns_store.lock() {
                guard.clear();
            }
            emit_errors_cleared(app, sid);
        }
        return;
    }

    if let Ok(mut guard) = patterns_store.lock() {
        *guard = found.clone();
    }

    *had_errors = true;
    emit_error_detected(app, sid, found);
}

pub fn validate_cwd(cwd: &str) -> Result<(), AppError> {
    let path = Path::new(cwd);
    if !path.is_dir() {
        return Err(AppError::Terminal(format!("cwd is not a directory: {cwd}")));
    }
    Ok(())
}
