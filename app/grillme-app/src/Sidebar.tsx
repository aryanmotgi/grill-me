import { GrillmeState, PaneName } from "./types";

interface Props {
  state: GrillmeState | null;
  projectRoot: string | null;
  active: PaneName;
  learnCount?: number;
  onSelect: (p: PaneName) => void;
  onSwitchProject: () => void;
}

const ITEMS: { id: PaneName; label: string }[] = [
  { id: "projects", label: "Projects" },
  { id: "claude-web", label: "Claude.ai" },
  { id: "timeline", label: "Timeline" },
  { id: "search", label: "Search" },
  { id: "memory", label: "Memory" },
  { id: "cost", label: "Cost" },
  { id: "voice", label: "Voice" },
  { id: "overview", label: "Overview" },
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

export default function Sidebar({ state, projectRoot, active, learnCount, onSelect, onSwitchProject }: Props) {
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
        {ITEMS.map((it) => {
          const badge = it.id === "learn" && learnCount && learnCount > 0 ? learnCount : null;
          return (
            <button
              key={it.id}
              className={active === it.id ? "active" : ""}
              onClick={() => onSelect(it.id)}
            >
              <span>{it.label}</span>
              {badge != null && <span className="nav-badge">{badge}</span>}
            </button>
          );
        })}
      </nav>
      <button onClick={onSwitchProject}>Switch project</button>
    </aside>
  );
}
