// cost.rs — Aggregates Claude Code CLI token usage from
// ~/.claude/projects/<encoded>/<session>.jsonl.
//
// Each JSONL line is one event. Assistant turns carry a `message.usage`
// object with input/output/cache token counts. We sum those into per-day
// and per-project buckets, then estimate dollar cost using fixed
// Sonnet 4.5 list prices (documented below — verify against current
// Anthropic pricing when in doubt).
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

// Claude Sonnet 4.5 list pricing (USD per 1M tokens).
// If you change models, update these.
const INPUT_COST_PER_MTOK: f64 = 3.00;
const OUTPUT_COST_PER_MTOK: f64 = 15.00;
const CACHE_WRITE_COST_PER_MTOK: f64 = 3.75;
const CACHE_READ_COST_PER_MTOK: f64 = 0.30;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct UsageBucket {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
    pub message_count: i64,
    pub estimated_cost_usd: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DailyUsage {
    pub date: String, // YYYY-MM-DD
    pub usage: UsageBucket,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProjectUsage {
    pub cwd: String,
    pub display_name: String,
    pub usage: UsageBucket,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UsageSummary {
    pub total: UsageBucket,
    pub by_day: Vec<DailyUsage>,
    pub by_project: Vec<ProjectUsage>,
    pub days_covered: i64,
    pub source: String,
}

pub fn cost_for(b: &UsageBucket) -> f64 {
    (b.input_tokens as f64) * INPUT_COST_PER_MTOK / 1_000_000.0
        + (b.output_tokens as f64) * OUTPUT_COST_PER_MTOK / 1_000_000.0
        + (b.cache_creation_tokens as f64) * CACHE_WRITE_COST_PER_MTOK / 1_000_000.0
        + (b.cache_read_tokens as f64) * CACHE_READ_COST_PER_MTOK / 1_000_000.0
}

fn claude_projects_root() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".claude/projects"))
}

/// Decode "-Users-foo-bar" → "/Users/foo/bar". Lossy for cwds with literal
/// hyphens — caller falls back to encoded form for display if needed.
fn decode_encoded_dir(encoded: &str) -> String {
    let mut s = encoded.to_string();
    if s.starts_with('-') {
        s = s.replacen('-', "/", 1);
        s = s.replace('-', "/");
    }
    s
}

fn parse_rfc3339_to_secs(ts: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp())
}

fn date_from_ts(ts: &str) -> Option<String> {
    let dt = chrono::DateTime::parse_from_rfc3339(ts).ok()?;
    Some(dt.format("%Y-%m-%d").to_string())
}

fn add_bucket(dst: &mut UsageBucket, src: &UsageBucket) {
    dst.input_tokens += src.input_tokens;
    dst.output_tokens += src.output_tokens;
    dst.cache_creation_tokens += src.cache_creation_tokens;
    dst.cache_read_tokens += src.cache_read_tokens;
    dst.message_count += src.message_count;
}

pub fn aggregate_usage(days: i64) -> Result<UsageSummary, String> {
    let root = claude_projects_root().ok_or("HOME not set")?;
    if !root.exists() {
        return Ok(UsageSummary {
            total: UsageBucket::default(),
            by_day: vec![],
            by_project: vec![],
            days_covered: days,
            source: "cli".to_string(),
        });
    }

    let cutoff_secs: Option<i64> = if days > 0 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::from_secs(0))
            .as_secs() as i64;
        Some(now - days * 86_400)
    } else {
        None
    };

    let mut total = UsageBucket::default();
    let mut by_day: std::collections::HashMap<String, UsageBucket> =
        std::collections::HashMap::new();
    let mut by_project: std::collections::HashMap<String, ProjectUsage> =
        std::collections::HashMap::new();

    let project_iter = match fs::read_dir(&root) {
        Ok(it) => it,
        Err(e) => return Err(e.to_string()),
    };

    for entry in project_iter.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let encoded = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if encoded.is_empty() {
            continue;
        }

        let sessions = match fs::read_dir(&path) {
            Ok(it) => it,
            Err(_) => continue,
        };

        let mut project_cwd: Option<String> = None;

        for sf in sessions.flatten() {
            let sp = sf.path();
            if sp.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }

            // Short-circuit on file mtime if we have a cutoff.
            if let Some(cutoff) = cutoff_secs {
                if let Ok(meta) = fs::metadata(&sp) {
                    if let Ok(mtime) = meta.modified() {
                        if let Ok(d) = mtime.duration_since(UNIX_EPOCH) {
                            if (d.as_secs() as i64) < cutoff {
                                continue;
                            }
                        }
                    }
                }
            }

            let f = match fs::File::open(&sp) {
                Ok(f) => f,
                Err(_) => continue,
            };
            let reader = BufReader::new(f);

            for line in reader.lines().flatten() {
                let v: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => {
                        tracing::debug!("cost: skip malformed jsonl line");
                        continue;
                    }
                };

                // Capture cwd opportunistically (first line we see for this project).
                if project_cwd.is_none() {
                    if let Some(c) = v.get("cwd").and_then(|x| x.as_str()) {
                        project_cwd = Some(c.to_string());
                    }
                }

                let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if ty != "assistant" {
                    continue;
                }

                let usage = match v.get("message").and_then(|m| m.get("usage")) {
                    Some(u) => u,
                    None => continue,
                };

                let ts = v.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
                if ts.is_empty() {
                    continue;
                }

                if let Some(cutoff) = cutoff_secs {
                    if let Some(secs) = parse_rfc3339_to_secs(ts) {
                        if secs < cutoff {
                            continue;
                        }
                    }
                }

                let date = match date_from_ts(ts) {
                    Some(d) => d,
                    None => continue,
                };

                let input = usage
                    .get("input_tokens")
                    .and_then(|x| x.as_i64())
                    .unwrap_or(0);
                let output = usage
                    .get("output_tokens")
                    .and_then(|x| x.as_i64())
                    .unwrap_or(0);
                let cache_create = usage
                    .get("cache_creation_input_tokens")
                    .and_then(|x| x.as_i64())
                    .unwrap_or(0);
                let cache_read = usage
                    .get("cache_read_input_tokens")
                    .and_then(|x| x.as_i64())
                    .unwrap_or(0);

                let entry_bucket = UsageBucket {
                    input_tokens: input,
                    output_tokens: output,
                    cache_creation_tokens: cache_create,
                    cache_read_tokens: cache_read,
                    message_count: 1,
                    estimated_cost_usd: 0.0,
                };

                add_bucket(&mut total, &entry_bucket);
                let day_b = by_day.entry(date).or_insert_with(UsageBucket::default);
                add_bucket(day_b, &entry_bucket);

                let key = encoded.clone();
                let proj = by_project.entry(key).or_insert_with(|| {
                    let cwd = project_cwd
                        .clone()
                        .unwrap_or_else(|| decode_encoded_dir(&encoded));
                    let display_name = std::path::Path::new(&cwd)
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or(&cwd)
                        .to_string();
                    ProjectUsage {
                        cwd,
                        display_name,
                        usage: UsageBucket::default(),
                    }
                });
                add_bucket(&mut proj.usage, &entry_bucket);
            }
        }

        // After processing, if we discovered a real cwd, patch the project entry
        // (the entry was created with possibly the decoded fallback).
        if let (Some(cwd), Some(proj)) = (project_cwd.as_ref(), by_project.get_mut(&encoded)) {
            proj.cwd = cwd.clone();
            proj.display_name = std::path::Path::new(cwd)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(cwd)
                .to_string();
        }
    }

    // Fill costs.
    total.estimated_cost_usd = cost_for(&total);

    let mut by_day_vec: Vec<DailyUsage> = by_day
        .into_iter()
        .map(|(date, mut usage)| {
            usage.estimated_cost_usd = cost_for(&usage);
            DailyUsage { date, usage }
        })
        .collect();
    by_day_vec.sort_by(|a, b| b.date.cmp(&a.date));

    let mut by_project_vec: Vec<ProjectUsage> = by_project
        .into_values()
        .map(|mut p| {
            p.usage.estimated_cost_usd = cost_for(&p.usage);
            p
        })
        .collect();
    by_project_vec.sort_by(|a, b| {
        b.usage
            .estimated_cost_usd
            .partial_cmp(&a.usage.estimated_cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(UsageSummary {
        total,
        by_day: by_day_vec,
        by_project: by_project_vec,
        days_covered: days,
        source: "cli".to_string(),
    })
}

#[tauri::command]
pub fn get_usage_summary(days: i64) -> Result<UsageSummary, String> {
    aggregate_usage(days)
}
