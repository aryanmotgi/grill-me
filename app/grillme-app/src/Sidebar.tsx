import { GrillmeState, PaneName } from "./types";

interface Props {
  state: GrillmeState | null;
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

export default function Sidebar({ state, active, onSelect, onSwitchProject }: Props) {
  const project = state?.project ?? "No project";
  const truncated = project.length > 22 ? project.slice(0, 22) + "…" : project;
  return (
    <aside className="sidebar">
      <div>
        <h2 title={project}>{truncated}</h2>
        {state && (
          <div className="phase">
            <span className="dot" />
            Phase {state.phase_num}/6
          </div>
        )}
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
