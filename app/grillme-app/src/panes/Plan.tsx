import { GrillmeState } from "../types";

interface Props {
  state: GrillmeState | null;
  planMd: string;
}

interface Step {
  text: string;
  done: boolean;
}

function parseSteps(md: string): Step[] {
  const out: Step[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/);
    if (m) out.push({ done: m[1].toLowerCase() === "x", text: m[2].trim() });
  }
  if (out.length === 0) {
    // Fallback: numbered list "1. ..."
    for (const line of md.split("\n")) {
      const m = line.match(/^\s*(\d+)\.\s+(.*)$/);
      if (m) out.push({ done: false, text: m[2].trim() });
    }
  }
  return out;
}

export default function Plan({ state, planMd }: Props) {
  const steps = parseSteps(planMd);
  if (steps.length === 0) {
    return <div className="empty">PLAN.md is empty. Tell Claude what you're building.</div>;
  }
  const current = state?.current_step ?? 0;
  return (
    <ol className="plan-list">
      {steps.map((s, i) => {
        const idx = i + 1;
        const cls = s.done ? "done" : idx === current ? "current" : "";
        return (
          <li key={i} className={cls}>
            {idx}. {s.text}
          </li>
        );
      })}
    </ol>
  );
}
