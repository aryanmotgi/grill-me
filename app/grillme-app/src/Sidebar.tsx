import { GrillmeState, PaneName } from "./types";

interface Props {
  state: GrillmeState | null;
  projectRoot: string | null;
  active: PaneName;
  onSelect: (p: PaneName) => void;
  onSwitchProject: () => void;
}

const ITEMS: { id: PaneName; label: string }[] = [
  { id: "timer", label: "Timer" },
  { id: "plan", label: "Plan" },
  { id: "learn", label: "Learn" },
  { id: "codex", label: "Codex" },
];

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export default function Sidebar({ state, projectRoot, active, onSelect, onSwitchProject }: Props) {
  const project = state?.project ?? (projectRoot ? basename(projectRoot) : "No project");
  const truncated = project.length > 22 ? project.slice(0, 22) + "…" : project;
  const showPhase = state != null;
  return (
    <aside className="sidebar">
      <div>
        <h2 title={project}>{truncated}</h2>
        {showPhase ? (
          <div className="phase">
            <span className="dot" />
            Phase {state!.phase_num}/6
          </div>
        ) : projectRoot ? (
          <div className="phase muted">No session yet</div>
        ) : null}
      </div>
      <nav>
        {ITEMS.map((it) => (
          <button
            key={it.id}
            className={active === it.id ? "active" : ""}
            onClick={() => onSelect(it.id)}
          >
            {it.label}
          </button>
        ))}
      </nav>
      <button onClick={onSwitchProject}>Switch project</button>
    </aside>
  );
}
