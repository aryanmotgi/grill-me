mod watcher;

use std::fs;
use std::path::PathBuf;
use tracing::info;
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
        .invoke_handler(tauri::generate_handler![
            watcher::start_watch,
            watcher::stop_watch,
            watcher::read_watched_files,
            watcher::save_recent_project,
            watcher::get_recent_projects,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
