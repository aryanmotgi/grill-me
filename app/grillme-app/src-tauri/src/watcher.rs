use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use notify::RecommendedWatcher;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tracing::{error, info, warn};

/// Files inside the project root that we care about.
const WATCHED_FILES: &[&str] = &[
    ".grillme/state.json",
    "PLAN.md",
    "LEARNED.md",
    "GRILLME.md",
];

#[derive(Clone, Serialize)]
pub struct StateChangedPayload {
    pub file: String,
    pub content: String,
}

#[derive(Clone, Serialize)]
pub struct VersionMismatchPayload {
    pub version: serde_json::Value,
}

pub struct WatcherState {
    debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    root: Mutex<Option<PathBuf>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            debouncer: Mutex::new(None),
            root: Mutex::new(None),
        }
    }
}

/// Read a tracked file relative to project root and emit "state-changed".
fn emit_for_file(app: &AppHandle, root: &Path, rel: &str) {
    let abs = root.join(rel);
    match fs::read_to_string(&abs) {
        Ok(content) => {
            // If this is state.json, check version field.
            if rel == ".grillme/state.json" {
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(v) => {
                        let version = v.get("version").cloned().unwrap_or(serde_json::Value::Null);
                        if version != serde_json::Value::from(1) {
                            warn!(?version, "state.json version mismatch");
                            let _ = app.emit(
                                "version-mismatch",
                                VersionMismatchPayload { version },
                            );
                            return;
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "failed to parse state.json");
                    }
                }
            }
            info!(file = %rel, "emitting state-changed");
            let _ = app.emit(
                "state-changed",
                StateChangedPayload {
                    file: rel.to_string(),
                    content,
                },
            );
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // First-run before files exist — ignore.
        }
        Err(e) => {
            warn!(file = %rel, error = %e, "failed to read watched file");
        }
    }
}

/// Start watching `project_root`. Replaces any previous watcher.
#[tauri::command]
pub fn start_watch(
    app: AppHandle,
    state: State<'_, WatcherState>,
    project_root: String,
) -> Result<(), String> {
    let root = PathBuf::from(&project_root);
    if !root.exists() {
        return Err(format!("project root does not exist: {}", project_root));
    }

    info!(root = %project_root, "starting watcher");

    // Drop any prior watcher.
    {
        let mut guard = state.debouncer.lock().unwrap();
        *guard = None;
    }

    let app_handle = app.clone();
    let root_clone = root.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(100),
        move |res: DebounceEventResult| match res {
            Ok(events) => {
                let mut seen: std::collections::HashSet<String> = Default::default();
                for ev in events {
                    let p = ev.path;
                    for rel in WATCHED_FILES {
                        let target = root_clone.join(rel);
                        if p == target || p.ends_with(rel) {
                            if seen.insert((*rel).to_string()) {
                                emit_for_file(&app_handle, &root_clone, rel);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                error!(error = ?e, "watcher error");
            }
        },
    )
    .map_err(|e| {
        error!(error = %e, "failed to create debouncer");
        e.to_string()
    })?;

    // Watch project root recursively so .grillme/ creation is caught.
    if let Err(e) = debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
    {
        warn!(error = %e, "failed to watch project root");
        return Err(e.to_string());
    }

    // Initial emit for any files that already exist.
    for rel in WATCHED_FILES {
        emit_for_file(&app, &root, rel);
    }

    {
        let mut guard = state.debouncer.lock().unwrap();
        *guard = Some(debouncer);
    }
    {
        let mut guard = state.root.lock().unwrap();
        *guard = Some(root);
    }

    Ok(())
}

#[tauri::command]
pub fn stop_watch(state: State<'_, WatcherState>) {
    let mut guard = state.debouncer.lock().unwrap();
    *guard = None;
    let mut root_guard = state.root.lock().unwrap();
    *root_guard = None;
}

#[tauri::command]
pub fn read_watched_files(
    state: State<'_, WatcherState>,
) -> Result<Vec<StateChangedPayload>, String> {
    let root_guard = state.root.lock().unwrap();
    let Some(root) = root_guard.as_ref() else {
        return Ok(vec![]);
    };
    let mut out = vec![];
    for rel in WATCHED_FILES {
        let abs = root.join(rel);
        if let Ok(content) = fs::read_to_string(&abs) {
            out.push(StateChangedPayload {
                file: (*rel).to_string(),
                content,
            });
        }
    }
    Ok(out)
}

/// Append to recent.json in the app config dir.
#[tauri::command]
pub fn save_recent_project(app: AppHandle, path: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("recent.json");

    let mut list: Vec<String> = fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    list.retain(|p| p != &path);
    list.insert(0, path);
    list.truncate(10);

    let json = serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?;
    fs::write(&file, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_recent_projects(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    let file = dir.join("recent.json");
    Ok(fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default())
}
