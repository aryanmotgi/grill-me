#![allow(dead_code)]

// memory.rs — Phase 6 memory layer.
// Backend: sqlite-graph (kuzu Rust binding requires cmake which is not
// installed on this dev machine; the SQLite path provides the same public
// API and the frontend is unaware of the backend choice).
//
// Stores a graph of Concepts, Files, Persons, Decisions scoped per-project
// (and globally). Mentions are weighted by occurrence count per chat.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS mem_nodes (
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  meta TEXT,
  PRIMARY KEY (kind, name)
);
CREATE TABLE IF NOT EXISTS mem_chat_mentions (
  chat_id TEXT NOT NULL,
  project_cwd TEXT,
  node_kind TEXT NOT NULL,
  node_name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (chat_id, node_kind, node_name)
);
CREATE INDEX IF NOT EXISTS idx_mem_mentions_cwd  ON mem_chat_mentions(project_cwd, node_kind);
CREATE INDEX IF NOT EXISTS idx_mem_mentions_kind ON mem_chat_mentions(node_kind, node_name);

CREATE TABLE IF NOT EXISTS mem_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO mem_meta(key, value) VALUES('version', '1');
"#;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MemoryNode {
    pub kind: String,
    pub name: String,
    pub meta: Option<String>,
    pub mentions: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ExtractionStats {
    pub concepts: i64,
    pub files: i64,
    pub persons: i64,
    pub decisions: i64,
}

impl ExtractionStats {
    fn add(&mut self, other: &ExtractionStats) {
        self.concepts += other.concepts;
        self.files += other.files;
        self.persons += other.persons;
        self.decisions += other.decisions;
    }
}

pub struct Memory {
    conn: Mutex<Connection>,
}

// ---------- regexes / keyword lists ----------

static FILE_RE: Lazy<Regex> = Lazy::new(|| {
    // path-ish token ending in a known extension
    Regex::new(
        r#"(?i)([\w./\-]+\.(?:rs|tsx|ts|jsx|js|py|go|java|md|json|yaml|yml|toml|html|css|sql|sh))\b"#,
    )
    .unwrap()
});

static PERSON_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b([A-Z][a-z]+ [A-Z][a-z]+)\b").unwrap());

static DECISION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b(?:decided to|going with|let'?s use|we will|we'?ll|we should|let'?s go with)\b\s+([^\n\.\!\?]{1,160})",
    )
    .unwrap()
});

const CONCEPT_KEYWORDS: &[&str] = &[
    "postgres", "sqlite", "kuzu", "react", "rust", "tauri", "claude", "anthropic", "gpt",
    "vercel", "fly", "neon", "llm", "embedding", "fts", "rag", "openai", "supabase", "graphql",
    "websocket", "oauth", "jwt", "docker", "kubernetes", "redis", "node", "npm", "pnpm", "vite",
    "webpack", "eslint", "prettier", "typescript", "javascript", "async", "await", "mutex",
    "sqlite-graph", "cypher", "regex", "tokio", "serde",
];

const PERSON_DENYLIST: &[&str] = &[
    "Const Foo", "Mut Ref", "Pub Fn", "Let Mut", "Self Ok", "None None",
];

fn build_keyword_regex() -> Regex {
    let alts: Vec<String> = CONCEPT_KEYWORDS
        .iter()
        .map(|k| regex::escape(k))
        .collect();
    let pattern = format!(r"(?i)\b({})\b", alts.join("|"));
    Regex::new(&pattern).unwrap()
}

static KEYWORD_RE: Lazy<Regex> = Lazy::new(build_keyword_regex);

// ---------- core extractor ----------

#[derive(Default, Debug)]
struct Extraction {
    concepts: HashMap<String, i64>,
    files: HashMap<String, i64>,
    persons: HashMap<String, i64>,
    decisions: Vec<String>,
}

fn extract(text: &str) -> Extraction {
    let mut out = Extraction::default();

    // Files
    for cap in FILE_RE.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let s = m.as_str();
            if s.starts_with("http") || s.starts_with("//") {
                continue;
            }
            *out.files.entry(s.to_string()).or_insert(0) += 1;
        }
    }

    // Concepts
    for cap in KEYWORD_RE.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let s = m.as_str().to_lowercase();
            *out.concepts.entry(s).or_insert(0) += 1;
        }
    }

    // Persons (cap 5 unique)
    for cap in PERSON_RE.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let s = m.as_str();
            if PERSON_DENYLIST.iter().any(|d| d.eq_ignore_ascii_case(s)) {
                continue;
            }
            // Skip if obviously a code-y all-caps-y token; the regex already
            // restricts to FirstLast capitalized.
            *out.persons.entry(s.to_string()).or_insert(0) += 1;
            if out.persons.len() >= 5 {
                break;
            }
        }
    }

    // Decisions — one per message max
    if let Some(cap) = DECISION_RE.captures(text) {
        if let Some(m) = cap.get(0) {
            let mut s = m.as_str().trim().to_string();
            if s.len() > 160 {
                s.truncate(160);
            }
            out.decisions.push(s);
        }
    }

    out
}

// ---------- DB impl ----------

impl Memory {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
        )
        .map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA_SQL).map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn ingest_message(
        &self,
        chat_id: &str,
        project_cwd: Option<&str>,
        text: &str,
    ) -> Result<ExtractionStats, String> {
        if text.trim().is_empty() {
            return Ok(ExtractionStats::default());
        }
        let ex = extract(text);
        let mut stats = ExtractionStats::default();

        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        // Helper closure to upsert a node + mention.
        let upsert =
            |tx: &rusqlite::Transaction, kind: &str, name: &str, meta: Option<&str>, count: i64| -> rusqlite::Result<()> {
                tx.execute(
                    "INSERT OR IGNORE INTO mem_nodes(kind, name, meta) VALUES(?1, ?2, ?3)",
                    params![kind, name, meta],
                )?;
                tx.execute(
                    "INSERT INTO mem_chat_mentions(chat_id, project_cwd, node_kind, node_name, count)
                     VALUES(?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(chat_id, node_kind, node_name) DO UPDATE SET
                       count = count + excluded.count,
                       project_cwd = COALESCE(excluded.project_cwd, project_cwd)",
                    params![chat_id, project_cwd, kind, name, count],
                )?;
                Ok(())
            };

        for (name, c) in &ex.concepts {
            upsert(&tx, "Concept", name, Some("tech"), *c).map_err(|e| e.to_string())?;
            stats.concepts += 1;
        }
        for (name, c) in &ex.files {
            upsert(&tx, "File", name, None, *c).map_err(|e| e.to_string())?;
            stats.files += 1;
        }
        for (name, c) in &ex.persons {
            upsert(&tx, "Person", name, None, *c).map_err(|e| e.to_string())?;
            stats.persons += 1;
        }
        for d in &ex.decisions {
            upsert(&tx, "Decision", d, None, 1).map_err(|e| e.to_string())?;
            stats.decisions += 1;
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(stats)
    }

    pub fn list_project_nodes(
        &self,
        cwd: &str,
        limit: i64,
    ) -> Result<Vec<MemoryNode>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT m.node_kind, m.node_name, n.meta, SUM(m.count) AS mentions
                 FROM mem_chat_mentions m
                 LEFT JOIN mem_nodes n ON n.kind = m.node_kind AND n.name = m.node_name
                 WHERE m.project_cwd = ?1
                 GROUP BY m.node_kind, m.node_name
                 ORDER BY mentions DESC, m.node_name ASC
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![cwd, limit], |r| {
                Ok(MemoryNode {
                    kind: r.get(0)?,
                    name: r.get(1)?,
                    meta: r.get(2)?,
                    mentions: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn list_global_nodes(&self, limit: i64) -> Result<Vec<MemoryNode>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT m.node_kind, m.node_name, n.meta, SUM(m.count) AS mentions
                 FROM mem_chat_mentions m
                 LEFT JOIN mem_nodes n ON n.kind = m.node_kind AND n.name = m.node_name
                 GROUP BY m.node_kind, m.node_name
                 ORDER BY mentions DESC, m.node_name ASC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(MemoryNode {
                    kind: r.get(0)?,
                    name: r.get(1)?,
                    meta: r.get(2)?,
                    mentions: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn related_chats(
        &self,
        node_kind: &str,
        name: &str,
        limit: i64,
    ) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT chat_id
                 FROM mem_chat_mentions
                 WHERE node_kind = ?1 AND node_name = ?2
                 ORDER BY count DESC
                 LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![node_kind, name, limit], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }
}

// ---------- Tauri commands ----------

#[tauri::command]
pub fn memory_ingest_message(
    chat_id: String,
    project_cwd: Option<String>,
    text: String,
    state: tauri::State<Memory>,
) -> Result<ExtractionStats, String> {
    state.ingest_message(&chat_id, project_cwd.as_deref(), &text)
}

#[tauri::command]
pub fn memory_list_project_nodes(
    cwd: String,
    limit: i64,
    state: tauri::State<Memory>,
) -> Result<Vec<MemoryNode>, String> {
    state.list_project_nodes(&cwd, limit)
}

#[tauri::command]
pub fn memory_list_global_nodes(
    limit: i64,
    state: tauri::State<Memory>,
) -> Result<Vec<MemoryNode>, String> {
    state.list_global_nodes(limit)
}

#[tauri::command]
pub fn memory_related_chats(
    node_kind: String,
    name: String,
    limit: i64,
    state: tauri::State<Memory>,
) -> Result<Vec<String>, String> {
    state.related_chats(&node_kind, &name, limit)
}

#[tauri::command]
pub fn memory_backfill(
    state: tauri::State<Memory>,
    db_state: tauri::State<crate::db::Db>,
) -> Result<ExtractionStats, String> {
    // Walk all chats and ingest every message text.
    let chats = db_state.recent_chats(None, 10_000)?;
    let mut total = ExtractionStats::default();
    for chat in chats {
        let cwd = chat.cwd.as_deref();
        let msgs = db_state.list_messages(&chat.id, 10_000)?;
        for m in msgs {
            if let Some(text) = m.text.as_deref() {
                if text.trim().is_empty() {
                    continue;
                }
                let s = state.ingest_message(&chat.id, cwd, text)?;
                total.add(&s);
            }
        }
    }
    Ok(total)
}
