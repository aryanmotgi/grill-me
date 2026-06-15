#![allow(dead_code)]
// search.rs — Full-text search across captured messages backed by SQLite FTS5.
//
// Opens a read-only connection to the same grillme.db used by db.rs and runs
// FTS5 MATCH queries against the messages_fts virtual table. Returns
// snippet()-highlighted previews with <mark> tags for the UI.
//
// v1 treats user input as a phrase (wrapped in double quotes) for predictable
// behavior on free-text queries. Power syntax (AND/OR/NOT/*) can be opted in
// later.

use std::time::Instant;

use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchHit {
    pub message_id: i64,
    pub chat_id: String,
    pub source: String,
    pub role: String,
    pub snippet: String,
    pub text: Option<String>,
    pub ts: String,
    pub chat_title: Option<String>,
    pub chat_cwd: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    pub total: i64,
    pub query_ms: i64,
}

fn fts_phrase(raw: &str) -> String {
    let escaped = raw.replace('"', r#""""#);
    format!("\"{}\"", escaped)
}

fn truncate_text(t: Option<String>, max: usize) -> Option<String> {
    t.map(|s| {
        if s.chars().count() <= max {
            s
        } else {
            let mut out: String = s.chars().take(max).collect();
            out.push('…');
            out
        }
    })
}

#[tauri::command]
pub fn search_messages(
    app: tauri::AppHandle,
    query: String,
    source: Option<String>,
    project_cwd: Option<String>,
    limit: i64,
) -> Result<SearchResults, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(SearchResults {
            hits: vec![],
            total: 0,
            query_ms: 0,
        });
    }

    let limit = limit.clamp(1, 100);
    let phrase = fts_phrase(trimmed);

    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("grillme.db");

    let conn = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA query_only=1;")
        .map_err(|e| e.to_string())?;

    let started = Instant::now();

    let mut stmt = conn
        .prepare(
            "SELECT
                m.id, m.chat_id, m.source, m.role,
                snippet(messages_fts, 0, '<mark>', '</mark>', '…', 12) AS snippet,
                m.text, m.ts,
                c.title, c.cwd
             FROM messages_fts
             JOIN messages m ON m.id = messages_fts.rowid
             LEFT JOIN chats c ON c.id = m.chat_id
             WHERE messages_fts MATCH ?1
               AND (?2 IS NULL OR m.source = ?3)
               AND (?4 IS NULL OR c.cwd = ?5)
             ORDER BY rank
             LIMIT ?6",
        )
        .map_err(|e| e.to_string())?;

    let source_ref = source.as_deref();
    let cwd_ref = project_cwd.as_deref();

    let rows = stmt
        .query_map(
            params![phrase, source_ref, source_ref, cwd_ref, cwd_ref, limit],
            |row| {
                Ok(SearchHit {
                    message_id: row.get(0)?,
                    chat_id: row.get(1)?,
                    source: row.get(2)?,
                    role: row.get(3)?,
                    snippet: row.get(4)?,
                    text: truncate_text(row.get::<_, Option<String>>(5)?, 600),
                    ts: row.get(6)?,
                    chat_title: row.get(7)?,
                    chat_cwd: row.get(8)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let mut hits = Vec::new();
    for r in rows {
        hits.push(r.map_err(|e| e.to_string())?);
    }

    let query_ms = started.elapsed().as_millis() as i64;
    tracing::debug!(
        target: "grillme::search",
        "search_messages query='{}' hits={} ms={}",
        trimmed,
        hits.len(),
        query_ms
    );

    let total = hits.len() as i64;
    Ok(SearchResults {
        hits,
        total,
        query_ms,
    })
}
