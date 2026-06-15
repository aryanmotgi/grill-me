// ClaudeWeb.tsx — embedded claude.ai inside the app. Backed by a top-level
// WebviewWindow that's parented to the main window (NSWindow addChildWindow
// on macOS), so it tracks main-window movement and looks embedded. Unlike
// child-of-window webviews, a top-level window's .hide() is reliable, so
// switching panes actually makes claude.ai go away.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function ClaudeWeb() {
  const inlineRef = useRef<HTMLDivElement>(null);
  const [inlineOn, setInlineOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem("grillme.claudeWebOn") !== "0";
    } catch {
      return true;
    }
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("grillme.claudeWebOn", inlineOn ? "1" : "0");
    } catch {
      /* noop */
    }
  }, [inlineOn]);

  useEffect(() => {
    if (!inlineOn || !inlineRef.current) return;
    const el = inlineRef.current;

    function bounds() {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }

    let cancelled = false;

    async function show() {
      try {
        await invoke("show_claude_inline", bounds());
        setTimeout(() => {
          if (cancelled) return;
          invoke("enable_claude_scraper").catch((e) => {
            console.warn("enable_claude_scraper:", e);
          });
        }, 1500);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }

    async function move() {
      try {
        await invoke("move_claude_inline", bounds());
      } catch {
        /* noop */
      }
    }

    void show();
    const ro = new ResizeObserver(() => void move());
    ro.observe(el);
    window.addEventListener("resize", move);
    window.addEventListener("scroll", move, true);

    // Periodically re-install scraper in case claude.ai SPA navigated and
    // wiped the global. The install script is idempotent.
    const reinstall = setInterval(() => {
      if (cancelled) return;
      invoke("enable_claude_scraper").catch(() => {});
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(reinstall);
      ro.disconnect();
      window.removeEventListener("resize", move);
      window.removeEventListener("scroll", move, true);
      invoke("hide_claude_inline").catch(() => {});
    };
  }, [inlineOn]);

  useEffect(() => {
    return () => {
      invoke("hide_claude_inline").catch(() => {});
    };
  }, []);

  if (!inlineOn) {
    return (
      <div className="cc-empty">
        <h2>Claude.ai</h2>
        <p className="muted">
          Inline claude.ai is hidden. Open it to chat and have GrillMe capture
          every turn into the unified timeline.
        </p>
        <div className="cc-empty-actions">
          <button className="primary" onClick={() => setInlineOn(true)}>
            Open claude.ai inline
          </button>
          <button onClick={() => invoke("open_claude_window").catch((e) => setError(String(e)))}>
            Open in new window
          </button>
        </div>
        {error && <div className="banner">{error}</div>}
      </div>
    );
  }

  return (
    <div className="cc-inline-host">
      <div className="cc-inline-bar">
        <span className="muted small">claude.ai (live · scraping turns)</span>
        <button className="cc-inline-close" onClick={() => setInlineOn(false)} title="Hide">
          Hide
        </button>
      </div>
      <div className="cc-inline-slot" ref={inlineRef} />
      {error && <div className="banner">{error}</div>}
    </div>
  );
}
