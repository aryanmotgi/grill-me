import { GrillmeState } from "../types";

interface Props {
  state: GrillmeState | null;
  grillmeMd: string;
}

export default function Codex({ state, grillmeMd }: Props) {
  if (!state?.last_codex_run) {
    return <div className="empty">No Codex runs yet.</div>;
  }
  const when = new Date(state.last_codex_run).toLocaleString();
  const excerpt = grillmeMd
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(-3)
    .join("\n");
  return (
    <div>
      <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Last run: {when}</div>
      {excerpt && (
        <pre className="mono learn-entry" style={{ marginTop: 12 }}>
          {excerpt}
        </pre>
      )}
    </div>
  );
}
