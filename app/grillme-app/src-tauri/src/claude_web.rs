// claude_web.rs — Embed claude.ai inside the main GrillMe window via a
// Tauri child webview that overlays the Projects pane area.
//
// The React side measures the pane's bounding rect (getBoundingClientRect)
// and calls these commands to position / resize / show / hide / destroy
// the overlay. Cookies and localStorage persist in the app's user data
// directory, so login survives restarts.

use std::sync::{Mutex, OnceLock};

use tauri::{
    webview::WebviewBuilder, AppHandle, Listener, LogicalPosition, LogicalSize, Manager,
    WebviewUrl,
};
use tracing::{info, warn};

use crate::db;

const LABEL: &str = "claude-inline";
const MAIN_LABEL: &str = "main";
const CLAUDE_URL: &str = "https://claude.ai/";
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) \
                  AppleWebKit/605.1.15 (KHTML, like Gecko) \
                  Version/17.5 Safari/605.1.15";

pub struct ClaudeWebState {
    pub last_bounds: Mutex<Option<(f64, f64, f64, f64)>>,
}

impl ClaudeWebState {
    pub fn new() -> Self {
        Self {
            last_bounds: Mutex::new(None),
        }
    }
}

fn find_main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(MAIN_LABEL)
        .or_else(|| app.webview_windows().values().next().cloned())
}

// Inline overlay is a top-level child WebviewWindow (NOT a child webview
// embedded in main window). On macOS, child webviews of a window cannot be
// reliably hidden — the WKWebView NSView keeps painting on top of React DOM
// even after .hide() / .close(). A separate top-level window's .hide() maps
// to NSWindow.orderOut: which IS reliable. We give the window a parent so
// it tracks the main window's movement (looks embedded), and position it in
// screen coordinates based on the React slot's bounds plus the main
// window's content origin.

fn main_content_origin(win: &tauri::WebviewWindow) -> Result<(f64, f64), String> {
    // inner_position returns the top-left of the window's CONTENT area in
    // screen coordinates (excludes title bar / shadow). Returned as a
    // PhysicalPosition; convert to logical with the scale factor.
    let phys = win
        .inner_position()
        .map_err(|e| format!("inner_position: {e}"))?;
    let sf = win.scale_factor().map_err(|e| format!("scale_factor: {e}"))?;
    Ok((phys.x as f64 / sf, phys.y as f64 / sf))
}

#[tauri::command]
pub fn show_claude_inline(
    app: AppHandle,
    state: tauri::State<'_, ClaudeWebState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let main = find_main_window(&app).ok_or("main window not found")?;
    let (origin_x, origin_y) = main_content_origin(&main)?;
    let screen_x = origin_x + x.max(0.0);
    let screen_y = origin_y + y.max(0.0);

    {
        let mut g = state.last_bounds.lock().map_err(|e| e.to_string())?;
        *g = Some((x, y, width, height));
    }

    if let Some(existing) = app.get_webview_window(LABEL) {
        existing
            .set_position(LogicalPosition::new(screen_x, screen_y))
            .map_err(|e| format!("set_position: {e}"))?;
        existing
            .set_size(LogicalSize::new(width.max(100.0), height.max(100.0)))
            .map_err(|e| format!("set_size: {e}"))?;
        existing.show().map_err(|e| format!("show: {e}"))?;
        return Ok(());
    }

    let url: tauri::Url = CLAUDE_URL.parse().map_err(|e: url::ParseError| e.to_string())?;
    info!(
        "creating inline claude WebviewWindow at screen=({},{}) {}x{}",
        screen_x, screen_y, width, height
    );

    let base = tauri::WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::External(url),
    )
    .user_agent(UA)
    .decorations(false)
    .resizable(false)
    .inner_size(width.max(100.0), height.max(100.0))
    .position(screen_x, screen_y)
    .visible(true);

    // Parent the window so it tracks main window movement (NSWindow
    // addChildWindow). parent() consumes the builder and returns a Result.
    // Fall back to a non-parented window if the runtime rejects it.
    let built = match base.parent(&main) {
        Ok(parented) => parented.build(),
        Err(_) => tauri::WebviewWindowBuilder::new(
            &app,
            LABEL,
            WebviewUrl::External(CLAUDE_URL.parse::<tauri::Url>().unwrap()),
        )
        .user_agent(UA)
        .decorations(false)
        .resizable(false)
        .inner_size(width.max(100.0), height.max(100.0))
        .position(screen_x, screen_y)
        .visible(true)
        .build(),
    };
    built.map_err(|e| format!("build inline window: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn move_claude_inline(
    app: AppHandle,
    state: tauri::State<'_, ClaudeWebState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let main = find_main_window(&app).ok_or("main window not found")?;
    let (origin_x, origin_y) = main_content_origin(&main)?;
    let screen_x = origin_x + x.max(0.0);
    let screen_y = origin_y + y.max(0.0);

    {
        let mut g = state.last_bounds.lock().map_err(|e| e.to_string())?;
        *g = Some((x, y, width, height));
    }

    if let Some(existing) = app.get_webview_window(LABEL) {
        existing
            .set_position(LogicalPosition::new(screen_x, screen_y))
            .map_err(|e| format!("set_position: {e}"))?;
        existing
            .set_size(LogicalSize::new(width.max(100.0), height.max(100.0)))
            .map_err(|e| format!("set_size: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_claude_inline(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(LABEL) {
        // Top-level WebviewWindow.hide() maps to NSWindow.orderOut: — reliable.
        let _ = existing.hide();
    }
    Ok(())
}

/// Inject text into the inline claude.ai composer and (optionally) send.
/// The webview must already exist; if it doesn't, return an error so the UI
/// can open Claude first.
#[tauri::command]
pub fn bridge_to_claude(app: AppHandle, text: String, send: bool) -> Result<(), String> {
    let webview = app
        .webviews()
        .get(LABEL)
        .cloned()
        .ok_or("Open Claude inline first")?;

    // Escape for JS template literal.
    let payload = text
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace('$', "\\$");

    // claude.ai uses a contenteditable ProseMirror editor (not a textarea).
    // We find it, focus it, replace its content, dispatch input events so
    // React's onChange handlers fire, then click the send button if asked.
    let script = format!(
        r#"
(function() {{
  const text = `{payload}`;
  function findComposer() {{
    return document.querySelector('div[contenteditable="true"][role="textbox"]')
        || document.querySelector('div.ProseMirror')
        || document.querySelector('div[contenteditable="true"]')
        || document.querySelector('textarea');
  }}
  const ta = findComposer();
  if (!ta) {{
    console.warn('[grillme bridge] composer not found');
    return false;
  }}
  ta.focus();
  if (ta.tagName === 'TEXTAREA') {{
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', {{bubbles: true}}));
  }} else {{
    // contenteditable: use document.execCommand for compatibility with
    // ProseMirror's input handlers.
    const sel = window.getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(ta);
    sel.addRange(range);
    document.execCommand('insertText', false, text);
  }}
  if ({send_flag}) {{
    setTimeout(() => {{
      // Try common send-button patterns on claude.ai
      const btn = document.querySelector('button[aria-label="Send Message"]')
                || document.querySelector('button[aria-label="Send"]')
                || document.querySelector('button[data-testid="send-button"]');
      if (btn && !btn.disabled) btn.click();
    }}, 80);
  }}
  return true;
}})();
"#,
        payload = payload,
        send_flag = if send { "true" } else { "false" }
    );

    webview.eval(&script).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn destroy_claude_inline(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(LABEL) {
        let _ = existing.close();
        info!("destroy_claude_inline: WebviewWindow closed");
    } else {
        warn!("destroy_claude_inline: window not present");
    }
    Ok(())
}

// Keep the old window-based command around as a fallback for users who
// want Claude in a separate window.
#[tauri::command]
pub fn open_claude_window(app: AppHandle) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;
    const WIN_LABEL: &str = "claude-web";
    if let Some(existing) = app.get_webview_window(WIN_LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let url: tauri::Url = CLAUDE_URL.parse().map_err(|e: url::ParseError| e.to_string())?;
    WebviewWindowBuilder::new(&app, WIN_LABEL, WebviewUrl::External(url))
        .title("Claude")
        .inner_size(1100.0, 760.0)
        .min_inner_size(720.0, 480.0)
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn close_claude_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("claude-web") {
        let _ = w.close();
    }
    Ok(())
}

#[tauri::command]
pub fn is_claude_window_open(app: AppHandle) -> bool {
    app.get_webview_window("claude-web").is_some()
}

// ---------------------------------------------------------------------------
// claude.ai DOM scraper (Phase 1)
// ---------------------------------------------------------------------------
//
// We inject a small JavaScript observer into the inline claude.ai webview.
// On each conversation turn, the script emits a `claude-web-turn` Tauri event
// carrying the conversation_id, role, text, and timestamp. The Rust side
// receives the event, normalizes the payload, and writes it to the unified
// `messages` / `chats` SQLite tables. Selectors are fluid — if claude.ai
// changes its DOM, repair the SCRAPER_JS selector chain.

static SCRAPER_LISTENER_INSTALLED: OnceLock<()> = OnceLock::new();

const SCRAPER_JS: &str = r#"
(function() {
  if (window.__grillmeScraperInstalled) {
    console.log('[grillme-scraper] already installed, skipping');
    return;
  }
  window.__grillmeScraperInstalled = true;
  window.__grillmeSeenTurns = window.__grillmeSeenTurns || new Set();

  function conversationIdFromUrl() {
    const m = location.pathname.match(/\/(chat|projects)\/([0-9a-f-]{8,})/i);
    return m ? m[2] : ('untitled-' + Math.abs(hash(document.title || 'claude')));
  }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h;
  }

  function turnKey(role, text) {
    return role + '|' + (text || '').slice(0, 80);
  }

  function extractTurns() {
    // Try multiple selector strategies — claude.ai DOM is fluid.
    // S1: explicit data-testid (modern)
    let userNodes = document.querySelectorAll('[data-testid="user-message"]');
    let asstNodes = document.querySelectorAll('[data-testid="assistant-message"]');
    // S2: data-message-author-role (chat-gpt-style)
    if (userNodes.length === 0 && asstNodes.length === 0) {
      userNodes = document.querySelectorAll('[data-message-author-role="user"]');
      asstNodes = document.querySelectorAll('[data-message-author-role="assistant"]');
    }
    // S3: claude.ai class fallbacks
    if (asstNodes.length === 0) {
      asstNodes = document.querySelectorAll('div.font-claude-message');
    }
    if (userNodes.length === 0) {
      userNodes = document.querySelectorAll('div.font-user-message');
    }
    const turns = [];
    userNodes.forEach((el) => {
      const text = (el.innerText || '').trim();
      if (text) turns.push({ role: 'user', text, el });
    });
    asstNodes.forEach((el) => {
      const text = (el.innerText || '').trim();
      if (text) turns.push({ role: 'assistant', text, el });
    });
    // Sort by DOM order (rough proxy for turn order)
    turns.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return turns;
  }

  async function emitNew() {
    try {
      const conversation_id = conversationIdFromUrl();
      const title = (document.title || '').replace(' - Claude', '').replace(/^Claude$/, '').trim() || null;
      const turns = extractTurns();
      for (const t of turns) {
        const key = turnKey(t.role, t.text);
        if (window.__grillmeSeenTurns.has(key)) continue;
        window.__grillmeSeenTurns.add(key);
        const payload = {
          conversation_id,
          role: t.role,
          text: t.text,
          ts: new Date().toISOString(),
          title,
        };
        if (window.__TAURI__ && window.__TAURI__.event) {
          await window.__TAURI__.event.emit('claude-web-turn', payload);
        }
      }
    } catch (e) {
      console.warn('[grillme-scraper] sweep failed:', e);
    }
  }

  let sweepTimer = null;
  function scheduleSweep() {
    if (sweepTimer) return;
    sweepTimer = setTimeout(() => {
      sweepTimer = null;
      emitNew();
    }, 500);
  }

  // Reset seen-set on URL change (new conversation)
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      window.__grillmeSeenTurns = new Set();
      console.log('[grillme-scraper] conversation switched, reset seen-set');
      scheduleSweep();
    }
  }, 1000);

  const observer = new MutationObserver(() => scheduleSweep());
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // Initial sweep
  setTimeout(() => emitNew(), 1500);
  console.log('[grillme-scraper] installed');
})();
"#;

fn handle_scraper_event(app: &AppHandle, payload_str: &str) {
    #[derive(serde::Deserialize)]
    struct Payload {
        conversation_id: String,
        role: String,
        text: String,
        ts: String,
        #[serde(default)]
        title: Option<String>,
    }
    let p: Payload = match serde_json::from_str(payload_str) {
        Ok(p) => p,
        Err(e) => {
            warn!("scraper payload parse failed: {e} body={payload_str}");
            return;
        }
    };
    let db = match app.try_state::<db::Db>() {
        Some(d) => d,
        None => {
            warn!("scraper event but Db not in state");
            return;
        }
    };
    let chat = db::ChatRow {
        id: p.conversation_id.clone(),
        source: "web".into(),
        cwd: None,
        title: p.title,
        first_ts: Some(p.ts.clone()),
        last_ts: Some(p.ts.clone()),
    };
    if let Err(e) = db.upsert_chat(&chat) {
        warn!("upsert_chat failed: {e}");
    }
    let msg = db::NewMessage {
        chat_id: p.conversation_id,
        source: "web".into(),
        role: p.role,
        text: Some(p.text),
        tool_name: None,
        ts: p.ts,
        tokens_in: None,
        tokens_out: None,
        raw_uuid: None,
    };
    if let Err(e) = db.insert_message(&msg) {
        warn!("insert_message failed: {e}");
    }
}

#[tauri::command]
pub fn enable_claude_scraper(app: AppHandle) -> Result<(), String> {
    // Install the event listener once per process.
    SCRAPER_LISTENER_INSTALLED.get_or_init(|| {
        let app_handle = app.clone();
        app.listen("claude-web-turn", move |event| {
            handle_scraper_event(&app_handle, event.payload());
        });
        info!("claude-web-turn listener installed");
    });

    // Try the separate top-level window first (the reliable path),
    // then fall back to the legacy inline child webview if present.
    if let Some(win) = app.get_webview_window("claude-web") {
        return win
            .eval(SCRAPER_JS)
            .map_err(|e| format!("scraper inject (window): {e}"));
    }
    if let Some(existing) = app.webviews().get(LABEL).cloned() {
        return existing
            .eval(SCRAPER_JS)
            .map_err(|e| format!("scraper inject (inline): {e}"));
    }
    Err("Open Claude window first".into())
}
