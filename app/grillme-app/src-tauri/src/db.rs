#![allow(dead_code)]

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  cwd TEXT,
  title TEXT,
  first_ts TEXT,
  last_ts TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chats_last_ts ON chats(last_ts DESC);
CREATE INDEX IF NOT EXISTS idx_chats_source ON chats(source);
CREATE INDEX IF NOT EXISTS idx_chats_cwd ON chats(cwd);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT,
  tool_name TEXT,
  ts TEXT NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  raw_uuid TEXT,
  UNIQUE(chat_id, raw_uuid)
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, ts);
CREATE INDEX IF NOT EXISTS idx_messages_source_ts ON messages(source, ts DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_meta(key, value) VALUES('version', '1');
"#;

pub struct Db {
    conn: Mutex<Connection>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatRow {
    pub id: String,
    pub source: String,
    pub cwd: Option<String>,
    pub title: Option<String>,
    pub first_ts: Option<String>,
    pub last_ts: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MessageRow {
    pub id: i64,
    pub chat_id: String,
    pub source: String,
    pub role: String,
    pub text: Option<String>,
    pub tool_name: Option<String>,
    pub ts: String,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    pub raw_uuid: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NewMessage {
    pub chat_id: String,
    pub source: String,
    pub role: String,
    pub text: Option<String>,
    pub tool_name: Option<String>,
    pub ts: String,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    pub raw_uuid: Option<String>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
        )
        .map_err(|e| e.to_string())?;
        Self::init(&conn).map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn init(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(SCHEMA_SQL)?;
        Ok(())
    }

    pub fn upsert_chat(&self, row: &ChatRow) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Keep the EARLIEST first_ts and the LATEST last_ts across all
        // upserts for a given chat id. Without MIN/MAX, a later upsert
        // carrying an older scraped turn could regress last_ts.
        conn.execute(
            "INSERT INTO chats (id, source, cwd, title, first_ts, last_ts)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               source = excluded.source,
               cwd = COALESCE(excluded.cwd, chats.cwd),
               title = COALESCE(excluded.title, chats.title),
               first_ts = CASE
                 WHEN chats.first_ts IS NULL THEN excluded.first_ts
                 WHEN excluded.first_ts IS NULL THEN chats.first_ts
                 ELSE MIN(chats.first_ts, excluded.first_ts)
               END,
               last_ts = CASE
                 WHEN chats.last_ts IS NULL THEN excluded.last_ts
                 WHEN excluded.last_ts IS NULL THEN chats.last_ts
                 ELSE MAX(chats.last_ts, excluded.last_ts)
               END",
            params![
                row.id,
                row.source,
                row.cwd,
                row.title,
                row.first_ts,
                row.last_ts,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn insert_message(&self, msg: &NewMessage) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO messages
              (chat_id, source, role, text, tool_name, ts, tokens_in, tokens_out, raw_uuid)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                msg.chat_id,
                msg.source,
                msg.role,
                msg.text,
                msg.tool_name,
                msg.ts,
                msg.tokens_in,
                msg.tokens_out,
                msg.raw_uuid,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_messages(&self, chat_id: &str, limit: i64) -> Result<Vec<MessageRow>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, chat_id, source, role, text, tool_name, ts, tokens_in, tokens_out, raw_uuid
                 FROM messages
                 WHERE chat_id = ?1
                 ORDER BY ts ASC, id ASC
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![chat_id, limit], map_message_row)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn recent_chats(
        &self,
        source_filter: Option<&str>,
        limit: i64,
    ) -> Result<Vec<ChatRow>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let (sql, rows) = if let Some(src) = source_filter {
            let mut stmt = conn
                .prepare(
                    "SELECT id, source, cwd, title, first_ts, last_ts
                     FROM chats
                     WHERE source = ?1
                     ORDER BY last_ts DESC NULLS LAST
                     LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map(params![src, limit], map_chat_row)
                .map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for r in mapped {
                out.push(r.map_err(|e| e.to_string())?);
            }
            ("ok", out)
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT id, source, cwd, title, first_ts, last_ts
                     FROM chats
                     ORDER BY last_ts DESC NULLS LAST
                     LIMIT ?1",
                )
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map(params![limit], map_chat_row)
                .map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for r in mapped {
                out.push(r.map_err(|e| e.to_string())?);
            }
            ("ok", out)
        };
        let _ = sql;
        Ok(rows)
    }

    pub fn search(&self, query: &str, limit: i64) -> Result<Vec<MessageRow>, String> {
        // Wrap query as a single-quoted FTS5 literal to keep v1 simple/safe.
        let escaped = query.replace('"', "\"\"");
        let fts_query = format!("\"{}\"", escaped);
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT m.id, m.chat_id, m.source, m.role, m.text, m.tool_name, m.ts,
                        m.tokens_in, m.tokens_out, m.raw_uuid
                 FROM messages m
                 JOIN messages_fts ON m.id = messages_fts.rowid
                 WHERE messages_fts MATCH ?1
                 ORDER BY m.ts DESC
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![fts_query, limit], map_message_row)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }
}

fn map_message_row(row: &rusqlite::Row) -> rusqlite::Result<MessageRow> {
    Ok(MessageRow {
        id: row.get(0)?,
        chat_id: row.get(1)?,
        source: row.get(2)?,
        role: row.get(3)?,
        text: row.get(4)?,
        tool_name: row.get(5)?,
        ts: row.get(6)?,
        tokens_in: row.get(7)?,
        tokens_out: row.get(8)?,
        raw_uuid: row.get(9)?,
    })
}

fn map_chat_row(row: &rusqlite::Row) -> rusqlite::Result<ChatRow> {
    Ok(ChatRow {
        id: row.get(0)?,
        source: row.get(1)?,
        cwd: row.get(2)?,
        title: row.get(3)?,
        first_ts: row.get(4)?,
        last_ts: row.get(5)?,
    })
}
