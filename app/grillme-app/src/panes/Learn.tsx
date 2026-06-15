import { useEffect, useMemo, useState } from "react";

interface Props {
  learnedMd: string;
  onCountChange?: (n: number) => void;
}

interface Entry {
  id: string;
  concept: string;
  date?: string;
  ref?: string;
  question?: string;
  answer: string;
}

interface ReviewRecord {
  reviews: number;
  correct: number;
  lastReviewedISO?: string;
}

const LS_KEY = "grillme.reviews.v1";

function loadReviews(): Record<string, ReviewRecord> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveReviews(map: Record<string, ReviewRecord>) {
  localStorage.setItem(LS_KEY, JSON.stringify(map));
}

function entryId(concept: string, date?: string): string {
  return `${concept}|${date ?? ""}`.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Parse LEARNED.md into Entry[].
 *
 * Markdown shape per entry:
 *   ## <concept> — <YYYY-MM-DD>
 *
 *   _ref: `<path:line>`_         (optional)
 *
 *   **Q:** <question>            (optional, v3.1+)
 *
 *   **A:** <answer>              (required v3.1+; legacy: free text)
 */
function parseEntries(md: string): Entry[] {
  const entries: Entry[] = [];
  const blocks = md.split(/\n(?=##\s)/);
  for (const b of blocks) {
    const headMatch = b.match(/^##\s+(.+)$/m);
    if (!headMatch) continue;
    const heading = headMatch[1].trim();
    const dateMatch = heading.match(/(\d{4}-\d{2}-\d{2})/);
    const concept = heading.replace(/[\s—-]*\d{4}-\d{2}-\d{2}.*$/, "").trim();

    const refMatch = b.match(/_ref:\s*`([^`]+)`_/);
    const qMatch = b.match(/\*\*Q:\*\*\s*([\s\S]*?)(?=\n\s*\*\*A:\*\*|\n\s*##\s|$)/);
    const aMatch = b.match(/\*\*A:\*\*\s*([\s\S]*?)(?=\n\s*##\s|$)/);

    let answer: string;
    if (aMatch) {
      answer = aMatch[1].trim();
    } else {
      // Legacy: everything after the ref/heading is the answer.
      answer = b
        .replace(/^##\s+.+$/m, "")
        .replace(/_ref:\s*`[^`]+`_/g, "")
        .trim();
    }

    entries.push({
      id: entryId(concept, dateMatch?.[1]),
      concept,
      date: dateMatch?.[1],
      ref: refMatch?.[1],
      question: qMatch?.[1].trim() || undefined,
      answer,
    });
  }
  return entries.reverse();
}

type CardMode = "view" | "quiz" | "reveal" | "scored";

export default function Learn({ learnedMd, onCountChange }: Props) {
  const entries = useMemo(() => parseEntries(learnedMd), [learnedMd]);
  const [reviews, setReviews] = useState<Record<string, ReviewRecord>>(() => loadReviews());
  const [modes, setModes] = useState<Record<string, CardMode>>({});
  const [scores, setScores] = useState<Record<string, "got" | "missed">>({});

  useEffect(() => {
    onCountChange?.(entries.length);
  }, [entries.length, onCountChange]);

  function setMode(id: string, m: CardMode) {
    setModes((prev) => ({ ...prev, [id]: m }));
  }

  function recordScore(id: string, score: "got" | "missed") {
    const prev = reviews[id] ?? { reviews: 0, correct: 0 };
    const next: Record<string, ReviewRecord> = {
      ...reviews,
      [id]: {
        reviews: prev.reviews + 1,
        correct: prev.correct + (score === "got" ? 1 : 0),
        lastReviewedISO: new Date().toISOString(),
      },
    };
    setReviews(next);
    saveReviews(next);
    setScores((s) => ({ ...s, [id]: score }));
    setMode(id, "scored");
  }

  if (entries.length === 0) {
    return <div className="empty">Nothing learned yet. Quiz wins land here.</div>;
  }

  return (
    <div>
      {entries.slice(0, 12).map((e) => {
        const mode = modes[e.id] ?? "view";
        const rec = reviews[e.id];
        const score = scores[e.id];
        const hasQuiz = Boolean(e.question);

        return (
          <div className="learn-entry" key={e.id}>
            <div className="learn-head">
              <span className="concept">{e.concept}</span>
              {e.date && <span className="date">{e.date}</span>}
              {rec && (
                <span className="streak" title={`${rec.correct}/${rec.reviews} correct`}>
                  ★ {rec.correct}/{rec.reviews}
                </span>
              )}
            </div>

            {e.ref && <div className="learn-ref mono muted">ref: {e.ref}</div>}

            {/* View mode: show answer + Review button */}
            {mode === "view" && (
              <>
                <pre className="mono">{e.answer}</pre>
                {hasQuiz ? (
                  <button
                    className="review-btn"
                    onClick={() => setMode(e.id, "quiz")}
                    aria-label={`Review ${e.concept}`}
                  >
                    Review me
                  </button>
                ) : (
                  <span className="muted small">no quiz saved (legacy entry)</span>
                )}
              </>
            )}

            {/* Quiz mode: show only Q + Reveal button */}
            {mode === "quiz" && e.question && (
              <div className="quiz">
                <div className="quiz-q">{e.question}</div>
                <div className="quiz-actions">
                  <button onClick={() => setMode(e.id, "reveal")}>Reveal answer</button>
                  <button onClick={() => setMode(e.id, "view")}>Cancel</button>
                </div>
              </div>
            )}

            {/* Reveal mode: show A + score buttons */}
            {mode === "reveal" && (
              <div className="quiz">
                <div className="quiz-q muted small">{e.question}</div>
                <pre className="mono">{e.answer}</pre>
                <div className="quiz-actions">
                  <button className="score-got" onClick={() => recordScore(e.id, "got")}>
                    Got it
                  </button>
                  <button className="score-missed" onClick={() => recordScore(e.id, "missed")}>
                    Missed it
                  </button>
                </div>
              </div>
            )}

            {/* Scored mode: brief confirmation, return to view */}
            {mode === "scored" && (
              <div className="quiz">
                <div className={score === "got" ? "score-got-text" : "score-missed-text"}>
                  {score === "got" ? "Logged: got it." : "Logged: missed it. Try again later."}
                </div>
                <div className="quiz-actions">
                  <button onClick={() => setMode(e.id, "view")}>Done</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
