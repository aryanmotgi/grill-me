// Memory.tsx — Phase 6 graph-memory pane.
// Renders concepts/files/persons/decisions extracted from messages, scoped
// either to the current project or globally. Backed by the Rust `memory_*`
// commands.
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface MemoryNode {
  kind: string; // "Concept" | "File" | "Person" | "Decision"
  name: string;
  meta: string | null;
  mentions: number;
}

interface ExtractionStats {
  concepts: number;
  files: number;
  persons: number;
  decisions: number;
}

type Scope = "project" | "global";

const KINDS: { key: string; label: string }[] = [
  { key: "Concept", label: "Concepts" },
  { key: "File", label: "Files" },
  { key: "Person", label: "Persons" },
  { key: "Decision", label: "Decisions" },
];

const COL_LIMIT = 20;
const FETCH_LIMIT = 100;

export default function Memory({ projectRoot }: { projectRoot?: string | null }) {
  const [scope, setScope] = useState<Scope>(projectRoot ? "project" : "global");
  const [nodes, setNodes] = useState<MemoryNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<ExtractionStats | null>(null);

  // Force project scope to fall back to global if no projectRoot.
  useEffect(() => {
    if (!projectRoot && scope === "project") setScope("global");
  }, [projectRoot, scope]);

  const fetchNodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result: MemoryNode[];
      if (scope === "project" && projectRoot) {
        result = await invoke<MemoryNode[]>("memory_list_project_nodes", {
          cwd: projectRoot,
          limit: FETCH_LIMIT,
        });
      } else {
        result = await invoke<MemoryNode[]>("memory_list_global_nodes", {
          limit: FETCH_LIMIT,
        });
      }
      setNodes(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [scope, projectRoot]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  const byKind = useMemo(() => {
    const map: Record<string, MemoryNode[]> = {};
    for (const k of KINDS) map[k.key] = [];
    for (const n of nodes) {
      if (!map[n.kind]) map[n.kind] = [];
      map[n.kind].push(n);
    }
    for (const k of Object.keys(map)) {
      map[k] = map[k].slice(0, COL_LIMIT);
    }
    return map;
  }, [nodes]);

  const onBackfill = useCallback(async () => {
    setBackfilling(true);
    setBackfillResult(null);
    setError(null);
    try {
      const res = await invoke<ExtractionStats>("memory_backfill");
      setBackfillResult(res);
      await fetchNodes();
    } catch (e) {
      setError(String(e));
    } finally {
      setBackfilling(false);
    }
  }, [fetchNodes]);

  const tabBtn = (s: Scope, label: string, disabled = false): React.CSSProperties => ({
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid var(--border, #2a2a2a)",
    background: scope === s ? "var(--accent, #4a90e2)" : "transparent",
    color: scope === s ? "#fff" : "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    opacity: disabled ? 0.5 : 1,
  });

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Memory</h2>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => projectRoot && setScope("project")}
              disabled={!projectRoot}
              style={tabBtn("project", "This project", !projectRoot)}
              title={projectRoot ?? "No active project"}
            >
              This project
            </button>
            <button onClick={() => setScope("global")} style={tabBtn("global", "All projects")}>
              All projects
            </button>
          </div>
          {scope === "project" && projectRoot && (
            <span className="mono small muted" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>
              {projectRoot}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {backfillResult && (
            <span className="muted small">
              Backfilled: {backfillResult.concepts} concepts, {backfillResult.files} files,{" "}
              {backfillResult.persons} persons, {backfillResult.decisions} decisions
            </span>
          )}
          <button
            onClick={onBackfill}
            disabled={backfilling}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--border, #2a2a2a)",
              background: "transparent",
              cursor: backfilling ? "wait" : "pointer",
              fontSize: 12,
            }}
          >
            {backfilling ? "Backfilling…" : "Backfill memory"}
          </button>
        </div>
      </div>

      {error && (
        <div className="banner" style={{ padding: 8, border: "1px solid #c33", borderRadius: 6 }}>
          Error: {error}
        </div>
      )}

      {loading && nodes.length === 0 && <div className="cc-empty muted">Loading memory…</div>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {KINDS.map((k) => {
          const list = byKind[k.key] ?? [];
          return (
            <section
              key={k.key}
              style={{
                border: "1px solid var(--border, #2a2a2a)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                minHeight: 120,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <h3 style={{ margin: 0, fontSize: 14 }}>{k.label}</h3>
                <span className="muted small">{list.length}</span>
              </div>
              {list.length === 0 ? (
                <div className="cc-empty muted small">
                  No {k.label.toLowerCase()} extracted yet. Run Backfill memory.
                </div>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {list.map((n) => (
                    <li
                      key={`${n.kind}:${n.name}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        fontSize: 13,
                        alignItems: "baseline",
                      }}
                      title={n.meta ?? undefined}
                    >
                      <span
                        className={k.key === "File" || k.key === "Concept" ? "mono" : ""}
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                        }}
                      >
                        {n.name}
                      </span>
                      <span
                        className="mono small muted"
                        style={{
                          background: "var(--border, #2a2a2a)",
                          padding: "1px 6px",
                          borderRadius: 999,
                        }}
                      >
                        {n.mentions}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <div className="muted small">
        Extracted via lightweight heuristics (regex + keyword lists). LLM-grade extraction lands later.
      </div>
    </div>
  );
}
