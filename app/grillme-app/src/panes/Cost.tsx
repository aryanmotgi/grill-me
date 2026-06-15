// Cost.tsx — Phase 4 cost/usage dashboard pane.
// Calls the Rust `get_usage_summary` command and renders totals, a
// per-day bar chart (cost-normalized), and a top-10 projects table.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface UsageBucket {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  message_count: number;
  estimated_cost_usd: number;
}

interface DailyUsage {
  date: string;
  usage: UsageBucket;
}

interface ProjectUsage {
  cwd: string;
  display_name: string;
  usage: UsageBucket;
}

interface UsageSummary {
  total: UsageBucket;
  by_day: DailyUsage[];
  by_project: ProjectUsage[];
  days_covered: number;
  source: string;
}

const RANGES: { label: string; days: number }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "All time", days: 0 },
];

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function Cost() {
  const [days, setDays] = useState<number>(7);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<UsageSummary>("get_usage_summary", { days })
      .then((res) => {
        if (cancelled) return;
        setSummary(res);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const maxDayCost = useMemo(() => {
    if (!summary) return 0;
    return summary.by_day.reduce(
      (m, d) => Math.max(m, d.usage.estimated_cost_usd),
      0,
    );
  }, [summary]);

  const topProjects = useMemo(() => {
    if (!summary) return [];
    return summary.by_project.slice(0, 10);
  }, [summary]);

  const cardStyle: React.CSSProperties = {
    border: "1px solid var(--border, #2a2a2a)",
    borderRadius: 8,
    padding: 12,
    minWidth: 140,
    flex: "1 1 140px",
  };

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Cost &amp; Usage</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid var(--border, #2a2a2a)",
                background: days === r.days ? "var(--accent, #4a90e2)" : "transparent",
                color: days === r.days ? "#fff" : "inherit",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="banner" style={{ padding: 8, border: "1px solid #c33", borderRadius: 6 }}>
          Error: {error}
        </div>
      )}

      {loading && !summary && (
        <div className="cc-empty muted">Loading usage…</div>
      )}

      {summary && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={cardStyle}>
              <div className="muted small">Messages</div>
              <div className="mono" style={{ fontSize: 22, marginTop: 4 }}>
                {fmtNum(summary.total.message_count)}
              </div>
            </div>
            <div style={cardStyle}>
              <div className="muted small">Input tokens</div>
              <div className="mono" style={{ fontSize: 22, marginTop: 4 }}>
                {fmtNum(summary.total.input_tokens)}
              </div>
            </div>
            <div style={cardStyle}>
              <div className="muted small">Output tokens</div>
              <div className="mono" style={{ fontSize: 22, marginTop: 4 }}>
                {fmtNum(summary.total.output_tokens)}
              </div>
            </div>
            <div style={cardStyle}>
              <div className="muted small">Estimated cost</div>
              <div className="mono" style={{ fontSize: 22, marginTop: 4 }}>
                {fmtUsd(summary.total.estimated_cost_usd)}
              </div>
            </div>
          </div>

          <section>
            <h3 style={{ marginBottom: 8 }}>By day</h3>
            {summary.by_day.length === 0 ? (
              <div className="cc-empty muted">No usage in this range.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {summary.by_day.map((d) => {
                  const pct =
                    maxDayCost > 0
                      ? (d.usage.estimated_cost_usd / maxDayCost) * 100
                      : 0;
                  return (
                    <div
                      key={d.date}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "110px 1fr 90px",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span className="mono small">{d.date}</span>
                      <div
                        style={{
                          background: "var(--border, #2a2a2a)",
                          borderRadius: 4,
                          height: 14,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            background: "var(--accent, #4a90e2)",
                            width: `${pct}%`,
                            height: "100%",
                          }}
                        />
                      </div>
                      <span className="mono small" style={{ textAlign: "right" }}>
                        {fmtUsd(d.usage.estimated_cost_usd)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h3 style={{ marginBottom: 8 }}>Top projects</h3>
            {topProjects.length === 0 ? (
              <div className="cc-empty muted">No project usage yet.</div>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border, #2a2a2a)" }}>
                    <th style={{ padding: "6px 4px" }}>Project</th>
                    <th style={{ padding: "6px 4px", textAlign: "right" }}>Msgs</th>
                    <th style={{ padding: "6px 4px", textAlign: "right" }}>Input</th>
                    <th style={{ padding: "6px 4px", textAlign: "right" }}>Output</th>
                    <th style={{ padding: "6px 4px", textAlign: "right" }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {topProjects.map((p) => (
                    <tr
                      key={p.cwd}
                      style={{ borderBottom: "1px solid var(--border, #1a1a1a)" }}
                    >
                      <td style={{ padding: "6px 4px" }}>
                        <div>{p.display_name}</div>
                        <div className="muted small mono">{p.cwd}</div>
                      </td>
                      <td className="mono" style={{ padding: "6px 4px", textAlign: "right" }}>
                        {fmtNum(p.usage.message_count)}
                      </td>
                      <td className="mono" style={{ padding: "6px 4px", textAlign: "right" }}>
                        {fmtNum(p.usage.input_tokens)}
                      </td>
                      <td className="mono" style={{ padding: "6px 4px", textAlign: "right" }}>
                        {fmtNum(p.usage.output_tokens)}
                      </td>
                      <td className="mono" style={{ padding: "6px 4px", textAlign: "right" }}>
                        {fmtUsd(p.usage.estimated_cost_usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="muted small">
            Source: Claude Code CLI only. claude.ai web usage is not exposed by Anthropic.
          </div>
        </>
      )}
    </div>
  );
}
