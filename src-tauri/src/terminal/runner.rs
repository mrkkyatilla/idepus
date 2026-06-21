use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::shadow::CommandResult;
use crate::terminal::buffer::LineBuffer;
use crate::terminal::patterns::scan_lines;

const DEFAULT_TIMEOUT_SECS: u64 = 120;

pub fn default_command_for_workspace(cwd: &Path) -> Option<(String, Vec<String>)> {
    if cwd.join("Cargo.toml").is_file() {
        return Some(("cargo".into(), vec!["check".into()]));
    }
    let pkg = cwd.join("package.json");
    if pkg.is_file() {
        if let Ok(text) = std::fs::read_to_string(&pkg) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                if json
                    .get("scripts")
                    .and_then(|s| s.get("test"))
                    .and_then(|t| t.as_str())
                    .is_some()
                {
                    return Some(("npm".into(), vec!["test".into()]));
                }
            }
        }
    }
    None
}

pub fn run_command(
    cwd: &Path,
    command: &str,
    args: &[String],
    timeout: Duration,
) -> Result<CommandResult, AppError> {
    let mut child = Command::new(command)
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Shadow(format!("spawn {command}: {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Shadow("stdout pipe missing".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Shadow("stderr pipe missing".into()))?;

    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        use std::io::Read;
        let mut buf = LineBuffer::new();
        let mut out = [0u8; 4096];
        let mut err = [0u8; 4096];
        let mut out_reader = stdout;
        let mut err_reader = stderr;

        loop {
            let mut did_io = false;
            match out_reader.read(&mut out) {
                Ok(0) => {}
                Ok(n) => {
                    did_io = true;
                    buf.append(&String::from_utf8_lossy(&out[..n]));
                }
                Err(_) => break,
            }
            match err_reader.read(&mut err) {
                Ok(0) => {}
                Ok(n) => {
                    did_io = true;
                    buf.append(&String::from_utf8_lossy(&err[..n]));
                }
                Err(_) => break,
            }
            if !did_io {
                thread::sleep(Duration::from_millis(10));
            }
        }
        let _ = tx.send(buf);
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(CommandResult {
                        exit_code: -1,
                        passed: false,
                        output_lines: vec!["shadow command timed out".into()],
                        stderr_summary: "command timed out".into(),
                        skipped: false,
                    });
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(AppError::Shadow(e.to_string())),
        }
    };

    let buffer = rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap_or_else(|_| LineBuffer::new());
    let lines = buffer.tail_lines(50);
    let tail_text = lines.join("\n");
    let patterns = scan_lines(&lines);
    let exit_code = status.code().unwrap_or(-1);
    let passed = exit_code == 0 && patterns.is_empty();

    let stderr_summary = if patterns.is_empty() {
        tail_text.lines().rev().take(3).collect::<Vec<_>>().join("\n")
    } else {
        patterns
            .first()
            .map(|p| p.message.clone())
            .unwrap_or_else(|| tail_text.clone())
    };

    Ok(CommandResult {
        exit_code,
        passed,
        output_lines: lines,
        stderr_summary,
        skipped: false,
    })
}

pub fn run_command_auto(
    cwd: &Path,
    command: Option<&str>,
    args: Option<&[String]>,
    timeout_secs: Option<u64>,
) -> Result<CommandResult, AppError> {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS));

    if let Some(cmd) = command {
        let cmd_args = args.unwrap_or(&[]).to_vec();
        return run_command(cwd, cmd, &cmd_args, timeout);
    }

    if let Some((cmd, cmd_args)) = default_command_for_workspace(cwd) {
        return run_command(cwd, &cmd, &cmd_args, timeout);
    }

    Ok(CommandResult {
        exit_code: 0,
        passed: true,
        output_lines: vec!["no test command configured".into()],
        stderr_summary: String::new(),
        skipped: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn run_echo_command() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let result = run_command(tmp.path(), "echo", &["hello".into()], Duration::from_secs(10))
            .expect("run");
        assert_eq!(result.exit_code, 0);
        assert!(result.passed);
    }
}
