interface Props {
  learnedMd: string;
}

interface Entry {
  concept: string;
  date?: string;
  body: string;
}

function parseEntries(md: string): Entry[] {
  const entries: Entry[] = [];
  const blocks = md.split(/\n(?=##\s)/);
  for (const b of blocks) {
    const m = b.match(/^##\s+(.+)$/m);
    if (!m) continue;
    const heading = m[1].trim();
    // Optional date in heading: "Concept — 2026-06-14"
    const dateMatch = heading.match(/(\d{4}-\d{2}-\d{2})/);
    const concept = heading.replace(/[\s—-]*\d{4}-\d{2}-\d{2}.*$/, "").trim();
    const body = b.replace(/^##\s+.+$/m, "").trim();
    entries.push({ concept, date: dateMatch?.[1], body });
  }
  return entries.reverse();
}

export default function Learn({ learnedMd }: Props) {
  const entries = parseEntries(learnedMd);
  if (entries.length === 0) {
    return <div className="empty">Nothing learned yet. Quiz wins land here.</div>;
  }
  return (
    <div>
      {entries.slice(0, 12).map((e, i) => (
        <div className="learn-entry" key={i}>
          <span className="concept">{e.concept}</span>
          {e.date && <span className="date">{e.date}</span>}
          {e.body && <pre className="mono">{e.body}</pre>}
        </div>
      ))}
    </div>
  );
}
