import { useMemo } from "react";
import { marked } from "marked";
import { GrillmeState } from "../types";

interface Props {
  state: GrillmeState | null;
  grillmeMd: string;
}

/**
 * Parse a GRILLME.md file into named sections.
 *
 * Expected format (per templates/GRILLME.md):
 *   # GRILLME — ...
 *   ## What this is
 *   ...body...
 *   ## Who it's for
 *   ...body...
 *   ## Done when
 *   ...body...
 *   ## Stack
 *   ...body...
 *   ## Where I left off
 *   ...body...
 *   ## Blocking
 *   ...body...
 *   ## Decisions log
 *   ...body...
 *   ## Things I don't understand yet
 *   ...body...
 */
function parseSections(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!md) return out;
  const lines = md.split("\n");
  let currentKey = "";
  let buf: string[] = [];
  const flush = () => {
    if (currentKey) out[currentKey.toLowerCase().trim()] = buf.join("\n").trim();
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      flush();
      currentKey = m[1];
    } else if (currentKey) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

function render(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

const SECTIONS: Array<{ key: string; label: string; icon: string; size?: "lg" | "md" }> = [
  { key: "what this is", label: "What this is", icon: "◆", size: "lg" },
  { key: "where i left off", label: "Where I left off", icon: "▸", size: "lg" },
  { key: "blocking", label: "Blocking", icon: "⚠", size: "md" },
  { key: "done when", label: "Done when", icon: "✓", size: "md" },
  { key: "who it's for", label: "Who it's for", icon: "◉", size: "md" },
  { key: "stack", label: "Stack", icon: "▤", size: "md" },
  { key: "decisions log", label: "Decisions", icon: "◐", size: "md" },
  { key: "things i don't understand yet", label: "Open questions", icon: "?", size: "md" },
];

export default function Overview({ state, grillmeMd }: Props) {
  const sections = useMemo(() => parseSections(grillmeMd), [grillmeMd]);
  const hasMemory = Object.keys(sections).length > 0;

  if (!hasMemory) {
    return (
      <div className="overview">
        <div className="overview-empty">
          <h2>No project memory yet</h2>
          <p className="muted">
            Run <code>/grillme</code> in Claude Code on this project. The Orient phase will ask
            you 4 questions and write a <code>GRILLME.md</code> file. Once it lands here, this
            page becomes your full project context — survives <code>/clear</code>, survives
            closing your laptop, survives switching machines.
          </p>
        </div>
      </div>
    );
  }

  const projectName = state?.project ?? "Project";

  return (
    <div className="overview">
      <header className="overview-head">
        <h1>{projectName}</h1>
        {state && (
          <div className="overview-meta mono">
            <span>Phase {state.phase_num}/6 · {state.phase}</span>
            {state.current_step && state.total_steps ? (
              <span>Step {state.current_step}/{state.total_steps}</span>
            ) : null}
          </div>
        )}
      </header>

      <div className="overview-grid">
        {SECTIONS.map((s) => {
          const body = sections[s.key];
          if (!body) return null;
          return (
            <section
              key={s.key}
              className={`overview-card overview-${s.size ?? "md"}`}
              data-key={s.key}
            >
              <div className="overview-card-head">
                <span className="overview-icon">{s.icon}</span>
                <h3>{s.label}</h3>
              </div>
              <div
                className="overview-body markdown"
                dangerouslySetInnerHTML={{ __html: render(body) }}
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}
