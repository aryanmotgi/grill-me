import { useMemo } from "react";
import { marked } from "marked";
import { GrillmeState } from "../types";

interface Props {
  state: GrillmeState | null;
  planMd: string;
}

interface PlanDoc {
  title?: string;
  goal?: string;
  steps: string[];
  doneWhen?: string;
  /** Sections we don't render as cards (e.g. "Reference") show as raw markdown at bottom. */
  extraSections: Array<{ heading: string; body: string }>;
}

function parseSteps(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split("\n")) {
    const num = line.match(/^\s*\d+\.\s+(.*)$/);
    if (num) {
      out.push(num[1].trim());
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/);
    if (bullet) out.push(bullet[2].trim());
  }
  return out;
}

function parsePlan(md: string): PlanDoc {
  const doc: PlanDoc = { steps: [], extraSections: [] };
  if (!md) return doc;

  const lines = md.split("\n");
  let currentHeading = "";
  let buf: string[] = [];
  const sections: Array<{ heading: string; body: string }> = [];

  const flush = () => {
    if (currentHeading) sections.push({ heading: currentHeading, body: buf.join("\n").trim() });
    buf = [];
  };

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    if (h1) {
      flush();
      doc.title = h1[1].trim();
      currentHeading = "";
    } else if (h2) {
      flush();
      currentHeading = h2[1].trim();
    } else {
      buf.push(line);
    }
  }
  flush();

  for (const s of sections) {
    const key = s.heading.toLowerCase();
    if (key === "goal") doc.goal = s.body;
    else if (key === "steps") doc.steps = parseSteps(s.body);
    else if (key === "done when") doc.doneWhen = s.body;
    else doc.extraSections.push(s);
  }
  return doc;
}

function renderMd(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

function renderInline(md: string): string {
  const html = marked.parseInline(md, { async: false }) as string;
  return html;
}

export default function Plan({ state, planMd }: Props) {
  const doc = useMemo(() => parsePlan(planMd), [planMd]);
  const current = state?.current_step ?? 0;
  const total = state?.total_steps ?? doc.steps.length;
  const progress = total > 0 ? Math.min(1, current / total) : 0;

  if (!doc.title && doc.steps.length === 0 && !doc.goal) {
    return (
      <div className="empty">
        PLAN.md is empty. Run <code>/grillme</code> Phase 3 to lock a tight plan.
      </div>
    );
  }

  return (
    <div className="plan-pane">
      {doc.title && <h1 className="plan-title">{doc.title}</h1>}

      {doc.goal && (
        <div className="plan-goal">
          <div className="overview-card-head">
            <span className="overview-icon">◆</span>
            <h3>Goal</h3>
          </div>
          <p
            className="markdown plan-goal-body"
            dangerouslySetInnerHTML={{ __html: renderMd(doc.goal) }}
          />
        </div>
      )}

      {doc.steps.length > 0 && (
        <div className="plan-section">
          <div className="plan-section-head">
            <h3>Steps</h3>
            {total > 0 && (
              <span className="plan-progress-text mono">
                {current}/{total} · {Math.round(progress * 100)}%
              </span>
            )}
          </div>
          {total > 0 && (
            <div className="plan-progress-bar">
              <div className="plan-progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
          )}
          <ol className="plan-steps">
            {doc.steps.map((text, i) => {
              const idx = i + 1;
              const isCurrent = idx === current;
              const isDone = idx < current;
              const cls = isCurrent ? "current" : isDone ? "done" : "pending";
              return (
                <li key={i} className={`plan-step plan-step-${cls}`}>
                  <span className="plan-step-num">{String(idx).padStart(2, "0")}</span>
                  <span
                    className="plan-step-text markdown"
                    dangerouslySetInnerHTML={{ __html: renderInline(text) }}
                  />
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {doc.doneWhen && (
        <div className="plan-done-when">
          <div className="overview-card-head">
            <span className="overview-icon">✓</span>
            <h3>Done when</h3>
          </div>
          <div
            className="markdown"
            dangerouslySetInnerHTML={{ __html: renderMd(doc.doneWhen) }}
          />
        </div>
      )}

      {doc.extraSections.length > 0 && (
        <div className="plan-extras">
          {doc.extraSections.map((s) => (
            <details key={s.heading} className="plan-extra">
              <summary>{s.heading}</summary>
              <div
                className="markdown"
                dangerouslySetInnerHTML={{ __html: renderMd(s.body) }}
              />
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
