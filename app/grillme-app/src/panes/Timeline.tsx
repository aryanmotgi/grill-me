// Timeline.tsx — unified cross-source message timeline.
//
// Pulls flat rows from list_timeline (CLI + web merged, sorted DESC by ts) and
// shows them as compact cards with a source/role badge, chat title, relative
// time, and a truncated body. "Load more" paginates via before_ts of the last
// shown row.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface IngestStats {
  chats_seen: number;
  chats_new: number;
  messages_seen: number;
  messages_inserted: number;
  files_failed: number;
  duration_ms: number;
}

interface TimelineEntry {
  message_id: number;
  chat_id: string;
  source: string;
  role: string;
  text: string | null;
  ts: string;
  chat_title: string | null;
  chat_cwd: string | null;
}

type SourceFilter = "all" | "cli" | "web";

const PAGE_SIZE = 200;
const BODY_TRUNCATE = 400;
const TITLE_TRUNCATE = 60;

function relTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(t).toLocaleDateString();
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

export default function Timeline() {
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reingesting, setReingesting] = useState(false);
  const [statsToast, setStatsToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [hasMore, setHasMore] = useState(true);

  const debounceRef = useRef<number | null>(null);

  const sourceArg = filter === "all" ? null : filter;

  const fetchPage = useCallback(
    async (opts: { beforeTs: string | null; append: boolean }) => {
      const setBusy = opts.append ? setLoadingMore : setLoading;
      setBusy(true);
      setError(null);
      try {
        const rows = await invoke<TimelineEntry[]>("list_timeline", {
          source: sourceArg,
          projectCwd: null,
          query: null,
          limit: PAGE_SIZE,
          beforeTs: opts.beforeTs,
        });
        if (opts.append) {
          setEntries((prev) => [...prev, ...rows]);
        } else {
          setEntries(rows);
          setExpanded({});
        }
        setHasMore(rows.length === PAGE_SIZE);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [sourceArg]
  );

  // Debounced reload on filter change.
  useEffect(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      void fetchPage({ beforeTs: null, append: false });
    }, 150);
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [fetchPage]);

  async function reingest() {
    if (reingesting) return;
    setReingesting(true);
    setStatsToast("Ingesting CLI history…");
    setError(null);
    try {
      const stats = await invoke<IngestStats>("ingest_cli_history");
      setStatsToast(
        `Ingested ${stats.chats_seen} chats (${stats.chats_new} new), ${stats.messages_seen} messages in ${stats.duration_ms}ms`
      );
      await fetchPage({ beforeTs: null, append: false });
    } catch (e) {
      setError(String(e));
      setStatsToast(null);
    } finally {
      setReingesting(false);
      window.setTimeout(() => setStatsToast(null), 5000);
    }
  }

  function loadMore() {
    if (loadingMore || !hasMore || entries.length === 0) return;
    const last = entries[entries.length - 1];
    void fetchPage({ beforeTs: last.ts, append: true });
  }

  const isEmpty = !loading && entries.length === 0;

  const chips: { id: SourceFilter; label: string }[] = useMemo(
    () => [
      { id: "all", label: "All" },
      { id: "cli", label: "CLI only" },
      { id: "web", label: "Web only" },
    ],
    []
  );

  return (
    <div className="folder-picker">
      <header className="folder-picker-head">
        <div className="crumbs">
          <span className="crumb-current">Timeline</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {chips.map((c) => (
            <button
              key={c.id}
              className={filter === c.id ? "primary" : "crumb"}
              onClick={() => setFilter(c.id)}
            >
              {c.label}
            </button>
          ))}
          <button
            className="primary"
            onClick={reingest}
            disabled={reingesting}
            title="Walk ~/.claude/projects and import sessions into the local DB"
          >
            {reingesting ? "Ingesting…" : "Re-ingest CLI"}
          </button>
        </div>
      </header>

      {statsToast && <div className="banner">{statsToast}</div>}
      {error && <div className="banner">{error}</div>}

      <section className="folder-picker-section">
        {loading && entries.length === 0 ? (
          <div className="muted small cc-section-empty">Loading timeline…</div>
        ) : isEmpty ? (
          <div className="muted small cc-section-empty">
            No messages yet. Run Re-ingest CLI to pull your Claude Code
            history, or open claude.ai to start scraping web turns.
          </div>
        ) : (
          <div className="folder-list">
            {entries.map((e) => {
              const isExpanded = !!expanded[e.message_id];
              const body = e.text ?? "";
              const needsTrunc = body.length > BODY_TRUNCATE;
              const shown = isExpanded || !needsTrunc ? body : truncate(body, BODY_TRUNCATE);
              const titleText = e.chat_title
                ? truncate(e.chat_title, TITLE_TRUNCATE)
                : `Chat ${e.chat_id.slice(0, 8)}`;
              const srcLabel = e.source === "cli" ? "CLI" : e.source === "web" ? "WEB" : e.source.toUpperCase();
              const srcStyle: React.CSSProperties = {
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 4,
                fontFamily: "ui-monospace, monospace",
                background: e.source === "web" ? "#ffe0ec" : "#e5e7eb",
                color: e.source === "web" ? "#c2185b" : "#374151",
              };
              const roleStyle: React.CSSProperties = {
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 4,
                fontFamily: "ui-monospace, monospace",
                background: e.role === "assistant" ? "#e0f2fe" : "#f3f4f6",
                color: e.role === "assistant" ? "#075985" : "#374151",
              };
              return (
                <div key={e.message_id} className="folder-item" style={{ alignItems: "stretch", cursor: "default" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={srcStyle}>{srcLabel}</span>
                    <span style={roleStyle}>{e.role}</span>
                    <span className="folder-item-name" style={{ marginRight: "auto" }}>
                      {titleText}
                    </span>
                    <span className="folder-item-meta mono">{relTime(e.ts)}</span>
                  </div>
                  {shown && (
                    <div
                      className="folder-item-path"
                      style={{
                        whiteSpace: "pre-wrap",
                        marginTop: 6,
                        fontFamily: "inherit",
                        fontSize: 13,
                        lineHeight: 1.4,
                      }}
                    >
                      {shown}
                      {needsTrunc && (
                        <>
                          {" "}
                          <button
                            className="crumb"
                            style={{ fontSize: 11, padding: "0 4px" }}
                            onClick={() =>
                              setExpanded((prev) => ({
                                ...prev,
                                [e.message_id]: !isExpanded,
                              }))
                            }
                          >
                            {isExpanded ? "show less" : "show more"}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {e.source === "cli" && (
                    <div style={{ marginTop: 6 }}>
                      <span className="folder-item-meta mono" style={{ fontSize: 10 }}>
                        View in Projects
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {hasMore && entries.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
            <button className="crumb" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
