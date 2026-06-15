// Search.tsx — Phase 3 full-text search pane.
// Calls the Rust `search_messages` command (FTS5-backed) and renders
// snippet()-highlighted previews with <mark> tags.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SearchHit {
  message_id: number;
  chat_id: string;
  source: string;
  role: string;
  snippet: string;
  text: string | null;
  ts: string;
  chat_title: string | null;
  chat_cwd: string | null;
}

interface SearchResults {
  hits: SearchHit[];
  total: number;
  query_ms: number;
}

type SourceFilter = "all" | "cli" | "web";

const SOURCE_OPTIONS: { key: SourceFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "cli", label: "CLI" },
  { key: "web", label: "Web" },
];

// Defense-in-depth: allow only <mark>…</mark> in snippet HTML. Everything else
// is escaped. The Rust side already produces snippets with only these tags via
// snippet(messages_fts, 0, '<mark>', '</mark>', …).
function sanitizeSnippet(html: string): string {
  const escaped = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}

function relativeTime(ts: string): string {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return ts;
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

function truncateTitle(title: string | null, chatId: string): string {
  const raw = title && title.trim().length > 0 ? title : chatId;
  if (raw.length <= 60) return raw;
  return raw.slice(0, 57) + "…";
}

export default function Search() {
  const [query, setQuery] = useState<string>("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const reqIdRef = useRef(0);

  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < 2;

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }
    const myId = ++reqIdRef.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      const args = {
        query: trimmed,
        source: source === "all" ? null : source,
        projectCwd: null,
        limit: 100,
      };
      invoke<SearchResults>("search_messages", args)
        .then((res) => {
          if (myId !== reqIdRef.current) return;
          setResults(res);
          setError(null);
        })
        .catch((e) => {
          if (myId !== reqIdRef.current) return;
          setError(String(e));
          setResults(null);
        })
        .finally(() => {
          if (myId !== reqIdRef.current) return;
          setLoading(false);
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [trimmed, source]);

  const hits = results?.hits ?? [];

  const stats = useMemo(() => {
    if (!results) return null;
    return `${results.total} result${results.total === 1 ? "" : "s"} · ${results.query_ms}ms`;
  }, [results]);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      <h2 style={{ margin: 0 }}>Search</h2>

      <input
        autoFocus
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search every chat (CLI + claude.ai)…"
        style={{
          padding: "10px 12px",
          fontSize: 16,
          borderRadius: 8,
          border: "1px solid var(--border, #2a2a2a)",
          background: "transparent",
          color: "inherit",
          outline: "none",
        }}
      />

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSource(opt.key)}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid var(--border, #2a2a2a)",
                background: source === opt.key ? "var(--accent, #4a90e2)" : "transparent",
                color: source === opt.key ? "#fff" : "inherit",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <select
          disabled
          title="Project filter coming soon"
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: "1px solid var(--border, #2a2a2a)",
            background: "transparent",
            color: "inherit",
            fontSize: 12,
            opacity: 0.6,
          }}
        >
          <option>All projects</option>
        </select>
      </div>

      {error && (
        <div
          className="banner"
          style={{
            padding: 8,
            border: "1px solid #c33",
            borderRadius: 6,
            color: "#f88",
          }}
        >
          Error: {error}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {trimmed.length === 0 && (
          <div className="cc-empty muted">Type to search across every captured message.</div>
        )}

        {tooShort && (
          <div className="cc-empty muted">Type at least 2 characters.</div>
        )}

        {!tooShort && trimmed.length >= 2 && hits.length === 0 && !loading && !error && (
          <div className="cc-empty muted">No results.</div>
        )}

        {hits.map((h) => {
          const safeSnippet = sanitizeSnippet(h.snippet || "");
          return (
            <div
              key={h.message_id}
              style={{
                border: "1px solid var(--border, #2a2a2a)",
                borderRadius: 8,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span
                  style={{
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: h.source === "cli" ? "rgba(74, 144, 226, 0.2)" : "rgba(226, 144, 74, 0.2)",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {h.source}
                </span>
                <span style={{ flex: "0 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {truncateTitle(h.chat_title, h.chat_id)}
                </span>
                <span className="muted small" style={{ marginLeft: "auto" }}>
                  {relativeTime(h.ts)}
                </span>
              </div>

              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.45,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
                dangerouslySetInnerHTML={{ __html: safeSnippet }}
              />

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                  }}
                  className="muted small"
                  style={{ textDecoration: "none" }}
                >
                  open chat →
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <div className="muted small" style={{ borderTop: "1px solid var(--border, #2a2a2a)", paddingTop: 6 }}>
        {loading ? "Searching…" : stats ?? " "}
      </div>

      <style>{`mark { background: rgba(255, 220, 100, 0.35); color: inherit; padding: 0 1px; border-radius: 2px; }`}</style>
    </div>
  );
}
