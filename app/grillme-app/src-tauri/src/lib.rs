mod chat;
mod claude_projects;
mod claude_web;
mod cost;
mod db;
mod export;
mod ingest;
mod memory;
mod routing;
mod search;
mod watcher;

use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tracing::{info, warn};
use tracing_appender::rolling;
use tracing_subscriber::{fmt, EnvFilter};

fn init_logging() {
    // ~/Library/Logs/GrillMe/grillme-YYYYMMDD.log
    let log_dir: PathBuf = dirs_log_dir().unwrap_or_else(|| PathBuf::from("."));
    let _ = fs::create_dir_all(&log_dir);
    let file_appender = rolling::daily(&log_dir, "grillme.log");

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,grillme_app_lib=info"));

    let _ = fmt()
        .with_env_filter(filter)
        .with_writer(file_appender)
        .with_ansi(false)
        .try_init();

    info!("GrillMe app starting");
}

fn dirs_log_dir() -> Option<PathBuf> {
    // ~/Library/Logs/GrillMe on macOS
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/Logs/GrillMe"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(watcher::WatcherState::new())
        .manage(chat::ChatState::new())
        .manage(claude_web::ClaudeWebState::new())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app_data_dir: {e}"))?;
            let _ = fs::create_dir_all(&data_dir);
            let db_path = data_dir.join("grillme.db");
            match db::Db::open(&db_path) {
                Ok(db) => {
                    info!("opened grillme.db at {}", db_path.display());
                    app.manage(db);
                    // Auto-ingest Claude Code CLI history on startup. Cheap
                    // because INSERT OR IGNORE makes re-runs idempotent and
                    // BufReader streams the JSONL line-by-line. Runs in the
                    // background so it does not block app launch.
                    let app_handle = app.handle().clone();
                    std::thread::spawn(move || {
                        let state = app_handle.state::<db::Db>();
                        match ingest::ingest_cli_history(state) {
                            Ok(stats) => info!("auto-ingest: {stats:?}"),
                            Err(e) => warn!("auto-ingest failed: {e}"),
                        }
                    });
                }
                Err(e) => {
                    warn!("failed to open grillme.db at {}: {}", db_path.display(), e);
                }
            }
            // Memory graph (concepts/files/people/decisions per project + global).
            // Separate SQLite file so the main DB stays focused.
            let memory_path = data_dir.join("grillme-memory.db");
            match memory::Memory::open(&memory_path) {
                Ok(mem) => {
                    info!("opened grillme-memory.db at {}", memory_path.display());
                    app.manage(mem);
                }
                Err(e) => {
                    warn!(
                        "failed to open memory db at {}: {}",
                        memory_path.display(),
                        e
                    );
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            watcher::start_watch,
            watcher::stop_watch,
            watcher::read_watched_files,
            watcher::save_recent_project,
            watcher::get_recent_projects,
            chat::start_chat,
            chat::send_chat_message,
            chat::interrupt_chat,
            chat::stop_chat,
            claude_projects::list_claude_projects,
            claude_projects::list_claude_sessions,
            claude_projects::read_claude_session,
            claude_projects::pick_folder_dialog,
            claude_projects::find_chats_for_folder,
            claude_web::open_claude_window,
            claude_web::close_claude_window,
            claude_web::is_claude_window_open,
            claude_web::show_claude_inline,
            claude_web::move_claude_inline,
            claude_web::hide_claude_inline,
            claude_web::destroy_claude_inline,
            claude_web::bridge_to_claude,
            claude_web::enable_claude_scraper,
            cost::get_usage_summary,
            export::export_cli_session_markdown,
            export::export_web_chat_markdown,
            export::save_exported_chat_to_file,
            ingest::ingest_cli_history,
            ingest::list_timeline,
            search::search_messages,
            memory::memory_ingest_message,
            memory::memory_list_project_nodes,
            memory::memory_list_global_nodes,
            memory::memory_related_chats,
            memory::memory_backfill,
            routing::classify_prompt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
