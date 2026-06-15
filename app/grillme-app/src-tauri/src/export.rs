// export.rs — Render Claude Code (CLI) sessions and claude.ai (web) chats as
// clean Markdown. Used by the frontend Export/Copy/Share buttons.
//
// Two sources:
//   - CLI: parse ~/.claude/projects/<encoded>/<session>.jsonl directly
//   - Web: pull from the SQLite store populated by claude_web scraping
//
// We also provide a save-file dialog wrapper so the renderer can write the
// markdown to a user-chosen location.
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db;

#[derive(Serialize, Deserialize)]
pub struct ExportedChat {
    pub markdown: String,
    pub message_count: i64,
    pub title: String,
}

fn claude_projects_root() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".claude/projects"))
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn fmt_ts(ts: &str) -> String {
    // Pass-through ISO 8601 for v1; later we can prettify into relative
    // times ("2h ago") once we agree on a format.
    ts.to_string()
}

fn decode_encoded_dir(encoded: &str) -> String {
    // Claude Code encodes "/Users/foo/bar" as "-Users-foo-bar". Reverse it
    // best-effort; if the dir doesn't start with '-', return as-is.
    if let Some(stripped) = encoded.strip_prefix('-') {
        format!("/{}", stripped.replace('-', "/"))
    } else {
        encoded.to_string()
    }
}

fn truncate_title(s: &str, n: usize) -> String {
    let cleaned = s.lines().next().unwrap_or("").trim();
    if cleaned.chars().count() <= n {
        cleaned.to_string()
    } else {
        let mut acc = String::new();
        for (i, c) in cleaned.chars().enumerate() {
            if i >= n {
                break;
            }
            acc.push(c);
        }
        acc.push('…');
        acc
    }
}

fn render_markdown(
    title: &str,
    header_meta: &[(&str, &str)],
    turns: &[(String, String, String)],
) -> String {
    let mut out = String::new();
    out.push_str("# ");
    out.push_str(title);
    out.push_str("\n\n");

    for (k, v) in header_meta {
        out.push('_');
        out.push_str(k);
        out.push_str(": ");
        out.push_str(v);
        out.push_str("_\n");
    }
    out.push_str("\n---\n\n");

    if turns.is_empty() {
        out.push_str("_No renderable messages in this session._\n");
        return out;
    }

    for (role, ts, text) in turns {
        let role_display = match role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            other => other,
        };
        out.push_str("## ");
        out.push_str(role_display);
        if !ts.is_empty() {
            out.push_str(" · ");
            out.push_str(&fmt_ts(ts));
        }
        out.push_str("\n\n");
        out.push_str(text.trim());
        out.push_str("\n\n---\n\n");
    }
    out
}

/// Minimal JSONL parser for a single line — pulls (role, ts, text) when the
/// line is a renderable user/assistant turn. Returns None for everything
/// else (tool_use, snapshots, attachments, system, blank).
fn extract_turn(line: &str) -> Option<(String, String, String)> {
    let v: Value = serde_json::from_str(line).ok()?;
    let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if ty != "user" && ty != "assistant" {
        return None;
    }
    let ts = v
        .get("timestamp")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    let msg = v.get("message")?;
    let content = msg.get("content")?;

    let mut buf = String::new();
    let mut had_text = false;
    match content {
        Value::String(s) => {
            buf.push_str(s);
            had_text = !s.trim().is_empty();
        }
        Value::Array(arr) => {
            for block in arr {
                let bty = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if bty == "text" {
                    if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                        if !buf.is_empty() {
                            buf.push('\n');
                        }
                        buf.push_str(t);
                        had_text = true;
                    }
                }
                // Skip tool_use, tool_result, etc. for export.
            }
        }
        _ => {}
    }

    if !had_text {
        return None;
    }
    let trimmed = buf.trim().to_string();
    if trimmed.is_empty() {
        return None;
    }
    Some((ty.to_string(), ts, trimmed))
}

#[tauri::command]
pub fn export_cli_session_markdown(
    encoded_dir: String,
    session_id: String,
) -> Result<ExportedChat, String> {
    let root = claude_projects_root().ok_or("HOME not set")?;
    let path = root.join(&encoded_dir).join(format!("{session_id}.jsonl"));
    if !path.exists() {
        return Err("session not found".to_string());
    }

    let f = fs::File::open(&path).map_err(|_| "session not found".to_string())?;
    let reader = BufReader::new(f);

    let mut turns: Vec<(String, String, String)> = Vec::new();
    for line in reader.lines().flatten() {
        if let Some(turn) = extract_turn(&line) {
            turns.push(turn);
        }
    }

    let first_user_text = turns
        .iter()
        .find(|(r, _, _)| r == "user")
        .map(|(_, _, t)| t.clone());
    let title = first_user_text
        .as_deref()
        .map(|t| truncate_title(t, 60))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("Session {}", &session_id[0..8.min(session_id.len())]));

    let decoded_cwd = decode_encoded_dir(&encoded_dir);
    let exported = now_iso();
    let session_meta = format!("Claude Code CLI · Session {}", session_id);
    let header: Vec<(&str, &str)> = vec![
        ("Source", session_meta.as_str()),
        ("Project", decoded_cwd.as_str()),
        ("Exported", exported.as_str()),
    ];

    let markdown = render_markdown(&title, &header, &turns);
    let message_count = turns.len() as i64;

    Ok(ExportedChat {
        markdown,
        message_count,
        title,
    })
}

#[tauri::command]
pub fn export_web_chat_markdown(
    chat_id: String,
    state: tauri::State<db::Db>,
) -> Result<ExportedChat, String> {
    let messages = state.list_messages(&chat_id, 10_000)?;

    let mut turns: Vec<(String, String, String)> = Vec::new();
    for m in &messages {
        if m.role != "user" && m.role != "assistant" {
            continue;
        }
        let Some(text) = m.text.as_deref() else {
            continue;
        };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        turns.push((m.role.clone(), m.ts.clone(), trimmed.to_string()));
    }

    // Best-effort title lookup. recent_chats(Some("web"), 1000) is cheap for v1.
    let chats = state.recent_chats(Some("web"), 1000).unwrap_or_default();
    let chat_meta = chats.into_iter().find(|c| c.id == chat_id);
    let title = chat_meta
        .as_ref()
        .and_then(|c| c.title.clone())
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            turns
                .iter()
                .find(|(r, _, _)| r == "user")
                .map(|(_, _, t)| truncate_title(t, 60))
        })
        .unwrap_or_else(|| format!("Chat {}", chat_id));

    let exported = now_iso();
    let header: Vec<(&str, &str)> = vec![
        ("Source", "claude.ai (scraped)"),
        ("Exported", exported.as_str()),
    ];

    let markdown = render_markdown(&title, &header, &turns);
    let message_count = turns.len() as i64;

    Ok(ExportedChat {
        markdown,
        message_count,
        title,
    })
}

#[tauri::command]
pub async fn save_exported_chat_to_file(
    app: tauri::AppHandle,
    markdown: String,
    suggested_filename: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let chosen = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .set_file_name(&suggested_filename)
        .blocking_save_file();

    let Some(path) = chosen else {
        return Ok(None);
    };

    // FilePath -> string path. The plugin returns a FilePath enum; .to_string()
    // yields the absolute path on desktop platforms.
    let path_str = path.to_string();
    let pb = PathBuf::from(&path_str);
    fs::write(&pb, markdown).map_err(|e| e.to_string())?;
    Ok(Some(path_str))
}
