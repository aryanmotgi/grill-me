// claude_projects.rs — Reads Claude Code's on-disk session storage at
// ~/.claude/projects/ so the app can show real projects + chat history.
//
// On-disk shape:
//   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
//
// The encoded directory replaces "/" with "-" in the project's cwd
// (e.g. /Users/aryanmotgi/DealGhost → -Users-aryanmotgi-DealGhost). The
// authoritative cwd lives inside the JSONL lines themselves (every event
// carries `cwd`), so we read the first line of each session to recover it.
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Clone, Debug)]
pub struct ClaudeProject {
    pub encoded_dir: String,
    pub cwd: String,
    pub display_name: String,
    pub session_count: usize,
    pub latest_session_ts: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ClaudeSession {
    pub session_id: String,
    pub encoded_dir: String,
    pub cwd: String,
    pub title: String,
    pub first_user_message: Option<String>,
    pub first_ts: Option<String>,
    pub last_ts: Option<String>,
    pub message_count: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct ClaudeMessage {
    pub uuid: Option<String>,
    pub parent_uuid: Option<String>,
    pub ts: Option<String>,
    pub role: String, // "user" | "assistant" | "system" | "tool" | "snapshot"
    pub text: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<Value>,
    pub raw_type: String,
}

fn claude_projects_root() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".claude/projects"))
}

fn extract_cwd_from_line(line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(line).ok()?;
    v.get("cwd")?.as_str().map(|s| s.to_string())
}

fn extract_ts(line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(line).ok()?;
    v.get("timestamp")?.as_str().map(|s| s.to_string())
}

fn read_first_n_lines(path: &Path, n: usize) -> Vec<String> {
    let Ok(f) = fs::File::open(path) else {
        return vec![];
    };
    let reader = BufReader::new(f);
    let mut out = Vec::with_capacity(n);
    for (i, line) in reader.lines().enumerate() {
        if i >= n {
            break;
        }
        if let Ok(line) = line {
            out.push(line);
        }
    }
    out
}

/// Treat as injected boilerplate (NOT a real human message) so we don't
/// surface it as a session title. The Claude Code CLI prepends a lot of
/// context — hook outputs, plugin manifests, caveman-mode banner, slash-
/// command echoes, system-reminder tags, etc. We filter all of them.
fn looks_like_injected_text(text: &str) -> bool {
    let t = text.trim_start();
    if t.is_empty() {
        return true;
    }
    let head = t.chars().take(200).collect::<String>();
    let lower = head.to_lowercase();

    // Caveat banner Claude Code wraps around tool-loop user replies.
    if lower.starts_with("caveat:") || lower.contains("caveat: the messages below") {
        return true;
    }
    // Hook / command echo / system reminder XML.
    if t.starts_with('<')
        && (lower.contains("<command-message>")
            || lower.contains("<command-name>")
            || lower.contains("<system-reminder>")
            || lower.contains("<bash-input>")
            || lower.contains("<bash-stdout>")
            || lower.contains("<local-command-stdout>")
            || lower.contains("<user-prompt-submit"))
    {
        return true;
    }
    // Pure markdown context dump from plugin/skill injection.
    if t.starts_with('#') && lower.contains("session context") {
        return true;
    }
    // "From https://..." attachments (Claude Code pasted URL summaries).
    if lower.starts_with("from https://") {
        return true;
    }
    // Caveman boilerplate.
    if lower.starts_with("caveman mode active") || lower.contains("respond terse like smart caveman") {
        return true;
    }
    // Base directory of a skill (plugin/skill injection).
    if lower.starts_with("base directory for this skill") {
        return true;
    }
    false
}

/// Strip command-tag wrappers so we can still recover the text the user
/// typed inside them.
fn unwrap_command_message(text: &str) -> Option<String> {
    // <command-message>foo</command-message> ... <command-args>bar</command-args>
    // The actual user prompt usually lives in <command-args> or follows the
    // wrapper. Return the args content if present.
    if let Some(start) = text.find("<command-args>") {
        let rest = &text[start + "<command-args>".len()..];
        if let Some(end) = rest.find("</command-args>") {
            let args = rest[..end].trim();
            if !args.is_empty() && !looks_like_injected_text(args) {
                return Some(args.to_string());
            }
        }
    }
    None
}

fn first_user_text(path: &Path) -> Option<(String, String)> {
    // Returns (text, ts) of the first user-typed message in a session.
    // Skips snapshots, hook injections, system events, and Caveat: blocks.
    // Bails after N lines so a giant session with no real user message
    // doesn't stall the Recents fetch.
    const MAX_LINES: usize = 400;
    let f = fs::File::open(path).ok()?;
    let reader = BufReader::new(f);
    for (i, line) in reader.lines().flatten().enumerate() {
        if i >= MAX_LINES {
            break;
        }
        let v: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if ty != "user" {
            continue;
        }
        let msg = v.get("message")?;
        let content = msg.get("content");
        let ts = v
            .get("timestamp")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        let text = match content {
            Some(Value::String(s)) => Some(s.clone()),
            Some(Value::Array(arr)) => {
                let mut buf = String::new();
                let mut has_tool_result = false;
                for block in arr {
                    let bty = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if bty == "text" {
                        if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                            if !buf.is_empty() {
                                buf.push('\n');
                            }
                            buf.push_str(t);
                        }
                    } else if bty == "tool_result" {
                        has_tool_result = true;
                    }
                }
                if has_tool_result || buf.is_empty() {
                    None
                } else {
                    Some(buf)
                }
            }
            _ => None,
        };

        if let Some(t) = text {
            // Try recovering a real prompt inside command-message wrappers.
            if let Some(inner) = unwrap_command_message(&t) {
                return Some((inner, ts));
            }
            if !looks_like_injected_text(&t) {
                return Some((t, ts));
            }
        }
    }
    None
}

fn count_lines(_path: &Path) -> usize {
    // Was: scan the whole file. That stalled on long sessions. We don't
    // surface this count anywhere visible right now, so return 0 cheaply.
    0
}

fn last_line_ts(path: &Path) -> Option<String> {
    // Use the file's mtime as a fast proxy for "last activity" — accurate
    // for our purposes (recents sorting) and roughly free vs. scanning the
    // whole JSONL.
    let meta = fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?;
    let secs = mtime.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    // Format as ISO 8601 UTC so it sorts the same way real timestamps do.
    let datetime = chrono::DateTime::<chrono::Utc>::from_timestamp(secs as i64, 0)?;
    Some(datetime.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn truncate_for_title(s: &str, n: usize) -> String {
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

#[tauri::command]
pub fn list_claude_projects() -> Result<Vec<ClaudeProject>, String> {
    let root = claude_projects_root().ok_or("HOME not set")?;
    if !root.exists() {
        return Ok(vec![]);
    }

    let mut projects = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let encoded = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        let mut session_count = 0usize;
        let mut cwd: Option<String> = None;
        let mut latest_ts: Option<String> = None;

        if let Ok(rd) = fs::read_dir(&path) {
            for sf in rd.flatten() {
                let sp = sf.path();
                if sp.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                    continue;
                }
                session_count += 1;

                if cwd.is_none() {
                    for line in read_first_n_lines(&sp, 12) {
                        if let Some(c) = extract_cwd_from_line(&line) {
                            cwd = Some(c);
                            break;
                        }
                    }
                }
                if let Some(ts) = last_line_ts(&sp) {
                    latest_ts = Some(match latest_ts.take() {
                        Some(prev) if prev > ts => prev,
                        _ => ts,
                    });
                }
            }
        }

        if session_count == 0 {
            continue;
        }

        let resolved_cwd = cwd.unwrap_or_else(|| {
            // Fallback: decode "-Users-..." → "/Users/..."
            let mut s = encoded.clone();
            if s.starts_with('-') {
                s = s.replacen('-', "/", 1);
                s = s.replace('-', "/");
            }
            s
        });

        let display_name = Path::new(&resolved_cwd)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&resolved_cwd)
            .to_string();

        projects.push(ClaudeProject {
            encoded_dir: encoded,
            cwd: resolved_cwd,
            display_name,
            session_count,
            latest_session_ts: latest_ts,
        });
    }

    // Most recently active project first.
    projects.sort_by(|a, b| {
        b.latest_session_ts
            .as_deref()
            .unwrap_or("")
            .cmp(a.latest_session_ts.as_deref().unwrap_or(""))
    });

    Ok(projects)
}

/// Claude Code encodes a project directory by replacing path separators with
/// `-` (the leading `/` becomes a leading `-`). e.g. `/Users/x/foo` →
/// `-Users-x-foo`. Matches the dirs under `~/.claude/projects/`.
fn encode_cwd(cwd: &str) -> String {
    cwd.replace('/', "-")
}

/// Shared session-listing logic used by both `list_claude_sessions` (lookup by
/// encoded dir) and `find_chats_for_folder` (lookup by absolute cwd).
fn read_sessions_from_dir(project_dir: &Path, encoded_dir: &str) -> Vec<ClaudeSession> {
    let mut sessions = Vec::new();
    let Ok(rd) = fs::read_dir(project_dir) else {
        return sessions;
    };
    for entry in rd {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let session_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if session_id.is_empty() {
            continue;
        }

        // Pull cwd from the first few lines.
        let mut cwd: Option<String> = None;
        let mut first_ts: Option<String> = None;
        for line in read_first_n_lines(&path, 12) {
            if cwd.is_none() {
                cwd = extract_cwd_from_line(&line);
            }
            if first_ts.is_none() {
                first_ts = extract_ts(&line);
            }
        }

        let (first_user_message, first_user_ts) = match first_user_text(&path) {
            Some((t, ts)) => (Some(t), Some(ts)),
            None => (None, None),
        };

        let title = first_user_message
            .as_deref()
            .map(|t| truncate_for_title(t, 72))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("Session {}", &session_id[0..8.min(session_id.len())]));

        sessions.push(ClaudeSession {
            session_id,
            encoded_dir: encoded_dir.to_string(),
            cwd: cwd.unwrap_or_default(),
            title,
            first_user_message,
            first_ts: first_user_ts.or(first_ts),
            last_ts: last_line_ts(&path),
            message_count: count_lines(&path),
        });
    }

    sessions.sort_by(|a, b| {
        b.last_ts
            .as_deref()
            .unwrap_or("")
            .cmp(a.last_ts.as_deref().unwrap_or(""))
    });

    sessions
}

#[tauri::command]
pub fn list_claude_sessions(encoded_dir: String) -> Result<Vec<ClaudeSession>, String> {
    let root = claude_projects_root().ok_or("HOME not set")?;
    let project_dir = root.join(&encoded_dir);
    if !project_dir.exists() {
        return Err(format!("project dir not found: {}", project_dir.display()));
    }
    Ok(read_sessions_from_dir(&project_dir, &encoded_dir))
}

/// Find all Claude Code chats whose `cwd` matches the given absolute folder
/// path. Used by the frontend folder picker — returns `[]` (NOT an error) if
/// no chats exist yet for that folder.
#[tauri::command]
pub fn find_chats_for_folder(cwd: String) -> Result<Vec<ClaudeSession>, String> {
    let root = claude_projects_root().ok_or("HOME not set")?;
    let encoded = encode_cwd(&cwd);
    let project_dir = root.join(&encoded);
    if !project_dir.exists() {
        return Ok(vec![]);
    }
    Ok(read_sessions_from_dir(&project_dir, &encoded))
}

/// Open a native folder-picker dialog. Returns the selected absolute path, or
/// `None` if the user cancelled.
#[tauri::command]
pub async fn pick_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|f| f.to_string()))
}

#[tauri::command]
pub fn read_claude_session(
    encoded_dir: String,
    session_id: String,
) -> Result<Vec<ClaudeMessage>, String> {
    let root = claude_projects_root().ok_or("HOME not set")?;
    let path = root.join(&encoded_dir).join(format!("{session_id}.jsonl"));
    if !path.exists() {
        return Err(format!("session file not found: {}", path.display()));
    }

    let f = fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(f);
    let mut out = Vec::new();

    for line in reader.lines().flatten() {
        let v: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("").to_string();

        // We surface user/assistant messages and tool_use markers, plus
        // attachments (hook injections) flagged as "system" so the user can
        // optionally see the context the model received. file-history-snapshot
        // entries are skipped entirely — they bloat the view.
        if ty == "file-history-snapshot" {
            continue;
        }

        let uuid = v.get("uuid").and_then(|u| u.as_str()).map(String::from);
        let parent_uuid = v
            .get("parentUuid")
            .and_then(|u| u.as_str())
            .map(String::from);
        let ts = v.get("timestamp").and_then(|t| t.as_str()).map(String::from);

        let mut role = ty.clone();
        let mut text: Option<String> = None;
        let mut tool_name: Option<String> = None;
        let mut tool_input: Option<Value> = None;

        if ty == "attachment" {
            // Attachments are hook/plugin injections (Vercel skill banner,
            // Caveman mode preamble, etc.). They are NOT human input. Skip
            // entirely — never surface them in the chat view.
            continue;
        } else if ty == "user" || ty == "assistant" {
            let msg = v.get("message");
            if let Some(msg) = msg {
                let content = msg.get("content");
                let mut text_buf = String::new();
                if let Some(content) = content {
                    match content {
                        Value::String(s) => text_buf.push_str(s),
                        Value::Array(arr) => {
                            for block in arr {
                                let bty = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                match bty {
                                    "text" => {
                                        if let Some(t) =
                                            block.get("text").and_then(|t| t.as_str())
                                        {
                                            if !text_buf.is_empty() {
                                                text_buf.push('\n');
                                            }
                                            text_buf.push_str(t);
                                        }
                                    }
                                    "tool_use" => {
                                        tool_name = block
                                            .get("name")
                                            .and_then(|n| n.as_str())
                                            .map(String::from);
                                        tool_input = block.get("input").cloned();
                                    }
                                    "tool_result" => {
                                        let content_val =
                                            block.get("content").cloned().unwrap_or(Value::Null);
                                        let pretty = match content_val {
                                            Value::String(s) => s,
                                            other => other.to_string(),
                                        };
                                        if !text_buf.is_empty() {
                                            text_buf.push('\n');
                                        }
                                        text_buf.push_str(&pretty);
                                    }
                                    _ => {}
                                }
                            }
                        }
                        _ => {}
                    }
                }
                if !text_buf.is_empty() {
                    text = Some(text_buf);
                }
            }
        }

        // Filter user messages that are pure hook/command injection so the
        // chat view shows what the human actually typed, not Claude Code's
        // wrapper boilerplate. Recover wrapped prompts when possible.
        if ty == "user" {
            if let Some(t) = text.clone() {
                if let Some(inner) = unwrap_command_message(&t) {
                    text = Some(inner);
                } else if looks_like_injected_text(&t) {
                    // Pure injection / Caveat banner / system reminder.
                    // Don't render it.
                    continue;
                }
            } else if tool_name.is_none() {
                // Empty user turn with nothing to render.
                continue;
            }
        }

        out.push(ClaudeMessage {
            uuid,
            parent_uuid,
            ts,
            role,
            text,
            tool_name,
            tool_input,
            raw_type: ty,
        });
    }

    Ok(out)
}
