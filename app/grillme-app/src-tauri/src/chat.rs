// chat.rs — Bridge to the Node Claude Agent SDK sidecar.
//
// Spawns `node sidecar/chat.mjs <project_root>` per chat session, pipes
// stdin/stdout, and forwards each JSON line from the sidecar to the frontend
// as a `chat-event` Tauri event. The frontend sends user messages via
// `send_chat_message`. The session_id is owned by the sidecar; we just relay.
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tracing::{info, warn};

pub struct ChatState {
    inner: Mutex<Option<Inner>>,
}

struct Inner {
    child: Child,
    stdin: ChildStdin,
    project_root: PathBuf,
}

impl ChatState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Clone)]
struct ChatEvent {
    payload: Value,
}

fn sidecar_path(app: &AppHandle) -> PathBuf {
    // 1. Env override always wins (useful for testing).
    if let Ok(env) = std::env::var("GRILLME_SIDECAR_PATH") {
        let p = PathBuf::from(env);
        if p.exists() {
            return p;
        }
    }

    // 2. Bundled resource path (production .dmg).
    if let Ok(p) = app.path().resource_dir() {
        let candidate = p.join("sidecar/chat.mjs");
        if candidate.exists() {
            return candidate;
        }
    }

    // 3. Dev mode: derive from the running executable.
    // `cargo tauri dev` puts the binary at
    //   <app>/src-tauri/target/debug/grillme-app
    // Sidecar lives at <app>/sidecar/chat.mjs (three levels up + sidecar).
    if let Ok(exe) = std::env::current_exe() {
        for parents in 2..6 {
            let mut p = exe.clone();
            for _ in 0..parents {
                if !p.pop() {
                    break;
                }
            }
            let candidate = p.join("sidecar/chat.mjs");
            if candidate.exists() {
                return candidate;
            }
        }
    }

    // 4. Last resort: cwd.
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    cwd.join("sidecar/chat.mjs")
}

#[tauri::command]
pub fn start_chat(
    app: AppHandle,
    state: State<'_, ChatState>,
    project_root: String,
) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;

    // Idempotent: if a chat is already running for the same project, no-op.
    // If it's running for a different project, tear it down before starting fresh.
    if let Some(existing) = guard.as_ref() {
        if existing.project_root == PathBuf::from(&project_root) {
            return Ok(());
        }
        // Different project: teardown.
        if let Some(mut old) = guard.take() {
            let _ = old.stdin.write_all(b"{\"type\":\"shutdown\"}\n");
            let _ = old.stdin.flush();
            std::thread::sleep(std::time::Duration::from_millis(100));
            let _ = old.child.kill();
            let _ = old.child.wait();
        }
    }

    let script = sidecar_path(&app);
    if !script.exists() {
        return Err(format!(
            "sidecar script not found at {}",
            script.display()
        ));
    }

    info!(
        "starting chat sidecar script={} cwd={}",
        script.display(),
        project_root
    );

    // Node is required on PATH. We don't bundle it for v0; the user already
    // has it (we installed @anthropic-ai/claude-agent-sdk via npm).
    let mut child = Command::new("node")
        .arg(&script)
        .arg(&project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    // stdout → chat-event
    let app_for_stdout = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(v) => {
                    if let Err(e) = app_for_stdout.emit("chat-event", ChatEvent { payload: v }) {
                        warn!("emit chat-event failed: {e}");
                    }
                }
                Err(e) => {
                    warn!("sidecar emitted non-JSON line: {e}: {line}");
                }
            }
        }
        info!("chat sidecar stdout closed");
    });

    // stderr → log file only
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                warn!(target: "sidecar", "{line}");
            }
        }
    });

    *guard = Some(Inner {
        child,
        stdin,
        project_root: project_root.into(),
    });

    Ok(())
}

#[tauri::command]
pub fn send_chat_message(
    state: State<'_, ChatState>,
    text: String,
    session_id: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    let inner = guard
        .as_mut()
        .ok_or("chat not started; call start_chat first")?;
    let mut req = serde_json::json!({ "type": "user", "text": text });
    if let Some(sid) = session_id {
        req["session_id"] = serde_json::Value::String(sid);
    }
    if let Some(c) = cwd {
        req["cwd"] = serde_json::Value::String(c);
    }
    let line = format!("{}\n", req);
    inner
        .stdin
        .write_all(line.as_bytes())
        .map_err(|e| format!("write to sidecar failed: {e}"))?;
    inner
        .stdin
        .flush()
        .map_err(|e| format!("flush sidecar stdin failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn interrupt_chat(state: State<'_, ChatState>) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    let inner = guard
        .as_mut()
        .ok_or("chat not started")?;
    let req = serde_json::json!({ "type": "interrupt" });
    let line = format!("{}\n", req);
    let _ = inner.stdin.write_all(line.as_bytes());
    let _ = inner.stdin.flush();
    Ok(())
}

#[tauri::command]
pub fn stop_chat(state: State<'_, ChatState>) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    let Some(mut inner) = guard.take() else {
        return Ok(());
    };
    let _ = inner.stdin.write_all(b"{\"type\":\"shutdown\"}\n");
    let _ = inner.stdin.flush();
    // Give the sidecar a moment to flush; then kill.
    std::thread::sleep(std::time::Duration::from_millis(150));
    let _ = inner.child.kill();
    let _ = inner.child.wait();
    info!(
        "chat sidecar stopped (was watching {})",
        inner.project_root.display()
    );
    Ok(())
}
