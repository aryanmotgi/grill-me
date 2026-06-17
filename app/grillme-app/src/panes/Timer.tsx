// Timer.tsx — hackathon timer with editable duration + checkpoints.
//
// Two halves:
//   1. Big countdown driven by state.json `started_at` + `hackathon_hours`.
//   2. User-defined checkpoints (a checklist) with a time-remaining marker
//      ("at T-30min" or "by 3:00 PM"). Stored in localStorage per-project so
//      it survives /clear, app restart, and machine switches.
//
// User can also override the started_at + duration in-app (writes to local
// state, doesn't touch the skill-owned state.json — that's the source of
// truth for actual sessions). The in-app override is a fallback for when no
// /grillme session is running.
import { useEffect, useMemo, useRef, useState } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { GrillmeState } from "../types";

interface Props {
  state: GrillmeState | null;
}

interface Checkpoint {
  id: string;
  /** Minutes before deadline this checkpoint should be hit. */
  minsRemaining: number;
  label: string;
  done: boolean;
}

interface LocalTimer {
  startedAtISO: string;
  hours: number;
  notifiedAtZero?: boolean;
}

const MILESTONES_DEFAULT_MINS = [180, 120, 60, 30, 10];

const LS_TIMER = "grillme.timer.v1";
const LS_CHECKPOINTS = "grillme.checkpoints.v1";
const LS_FIRED = "grillme.firedMilestones.v1";

function fmt(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uuid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function Timer({ state }: Props) {
  const [now, setNow] = useState(Date.now());
  const [localTimer, setLocalTimer] = useState<LocalTimer | null>(() =>
    loadJSON<LocalTimer | null>(LS_TIMER, null)
  );
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(() =>
    loadJSON<Checkpoint[]>(LS_CHECKPOINTS, [])
  );
  const [editing, setEditing] = useState(false);
  const [hoursIn, setHoursIn] = useState(String(localTimer?.hours ?? 4));
  const [showAddCp, setShowAddCp] = useState(false);
  const [newCpMins, setNewCpMins] = useState("30");
  const [newCpLabel, setNewCpLabel] = useState("");
  const firedRef = useRef<Set<number>>(new Set(loadJSON<number[]>(LS_FIRED, [])));

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Persist checkpoints + timer + fired milestones.
  useEffect(() => saveJSON(LS_CHECKPOINTS, checkpoints), [checkpoints]);
  useEffect(() => saveJSON(LS_TIMER, localTimer), [localTimer]);

  // Derive effective session: skill state takes precedence; fallback to local.
  const session = useMemo(() => {
    if (state?.started_at && state.hackathon_hours > 0) {
      return {
        startedAt: new Date(state.started_at).getTime(),
        hours: state.hackathon_hours,
        source: "skill" as const,
      };
    }
    if (localTimer) {
      return {
        startedAt: new Date(localTimer.startedAtISO).getTime(),
        hours: localTimer.hours,
        source: "local" as const,
      };
    }
    return null;
  }, [state?.started_at, state?.hackathon_hours, localTimer]);

  const endMs = session ? session.startedAt + session.hours * 3600 * 1000 : 0;
  const remaining = session ? endMs - now : 0;
  const minsLeft = session ? remaining / 60000 : 0;

  // Trigger milestone notifications.
  useEffect(() => {
    if (!session) return;
    const minsFloor = Math.floor(minsLeft);
    for (const m of MILESTONES_DEFAULT_MINS) {
      if (minsLeft <= m && minsLeft > 0 && !firedRef.current.has(m)) {
        firedRef.current.add(m);
        saveJSON(LS_FIRED, Array.from(firedRef.current));
        notify(`${m} minutes remaining`);
      }
    }
    // Reset fired set when timer restarts.
    if (minsLeft > 200 && firedRef.current.size > 0) {
      firedRef.current = new Set();
      saveJSON(LS_FIRED, []);
    }
    void minsFloor;
  }, [Math.floor(minsLeft), session?.startedAt]);

  // Notify when a checkpoint's threshold passes (once per checkpoint, while
  // the timer is running). The `due` state is derived from minsLeft in render
  // — we don't mutate the checkpoint here.
  const notifiedCpRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!session) return;
    for (const cp of checkpoints) {
      if (cp.done) continue;
      if (minsLeft <= cp.minsRemaining && minsLeft > 0 && !notifiedCpRef.current.has(cp.id)) {
        notifiedCpRef.current.add(cp.id);
        notify(`Checkpoint due: ${cp.label}`);
      }
    }
  }, [Math.floor(minsLeft), checkpoints, session?.startedAt]);

  async function notify(body: string) {
    try {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === "granted";
      if (ok) sendNotification({ title: "GrillMe", body });
    } catch {
      /* noop */
    }
  }

  function startLocalTimer(e: React.FormEvent) {
    e.preventDefault();
    const hours = Number(hoursIn);
    if (!Number.isFinite(hours) || hours <= 0) return;
    setLocalTimer({ startedAtISO: new Date().toISOString(), hours });
    firedRef.current = new Set();
    saveJSON(LS_FIRED, []);
    setEditing(false);
  }

  function clearLocalTimer() {
    setLocalTimer(null);
    setEditing(true);
  }

  function addCheckpoint(e: React.FormEvent) {
    e.preventDefault();
    const mins = Number(newCpMins);
    if (!Number.isFinite(mins) || mins <= 0 || !newCpLabel.trim()) return;
    setCheckpoints((prev) => [
      ...prev,
      { id: uuid(), minsRemaining: mins, label: newCpLabel.trim(), done: false },
    ]);
    setNewCpMins("30");
    setNewCpLabel("");
    setShowAddCp(false);
  }

  function toggleCheckpoint(id: string) {
    setCheckpoints((prev) =>
      prev.map((cp) => (cp.id === id ? { ...cp, done: !cp.done } : cp))
    );
  }

  function removeCheckpoint(id: string) {
    setCheckpoints((prev) => prev.filter((cp) => cp.id !== id));
  }

  // Color/state for the big display.
  let mood: "calm" | "watch" | "urgent" | "pulse" = "calm";
  if (session) {
    if (minsLeft <= 5) mood = "pulse";
    else if (minsLeft <= 30) mood = "urgent";
    else if (minsLeft <= 60) mood = "watch";
  }

  const overtime = session ? remaining <= 0 : false;
  const sortedCps = useMemo(
    () => [...checkpoints].sort((a, b) => b.minsRemaining - a.minsRemaining),
    [checkpoints]
  );

  return (
    <div className="timer-pane">
      {!session ? (
        <TimerSetup
          hoursIn={hoursIn}
          setHoursIn={setHoursIn}
          onStart={startLocalTimer}
        />
      ) : (
        <>
          <div className="timer-card">
            <div className="timer-card-head">
              <span className="mono timer-source">
                {session.source === "skill" ? "from /grillme" : "manual timer"}
              </span>
              {session.source === "local" && !editing && (
                <button className="timer-edit-btn" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
            </div>

            <div className={`timer-big timer-mood-${mood} ${mood === "pulse" ? "timer-pulse" : ""}`}>
              {overtime ? "00:00:00" : fmt(remaining)}
            </div>

            <div className="timer-meta mono">
              {overtime ? (
                <span className="timer-overtime">OVERTIME</span>
              ) : (
                <>
                  Started {new Date(session.startedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {" · "}
                  Ends {new Date(endMs).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </>
              )}
            </div>

            {editing && session.source === "local" && (
              <form className="timer-edit" onSubmit={startLocalTimer}>
                <label className="muted small">Restart with</label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={hoursIn}
                  onChange={(e) => setHoursIn(e.target.value)}
                />
                <span className="muted small">hours</span>
                <button type="submit" className="primary">Start</button>
                <button type="button" onClick={() => setEditing(false)}>Cancel</button>
                <button type="button" className="timer-clear" onClick={clearLocalTimer}>
                  Clear
                </button>
              </form>
            )}
          </div>

          <div className="checkpoints">
            <div className="checkpoints-head">
              <h3>Checkpoints</h3>
              <button onClick={() => setShowAddCp((v) => !v)} className="checkpoint-add">
                {showAddCp ? "Cancel" : "+ Add"}
              </button>
            </div>

            {showAddCp && (
              <form className="checkpoint-form" onSubmit={addCheckpoint}>
                <label className="muted small">At T-</label>
                <input
                  type="number"
                  min="1"
                  value={newCpMins}
                  onChange={(e) => setNewCpMins(e.target.value)}
                  className="cp-mins"
                />
                <span className="muted small">min</span>
                <input
                  type="text"
                  placeholder="What needs to be done?"
                  value={newCpLabel}
                  onChange={(e) => setNewCpLabel(e.target.value)}
                  autoFocus
                  className="cp-label"
                />
                <button type="submit" className="primary" disabled={!newCpLabel.trim()}>
                  Add
                </button>
              </form>
            )}

            {sortedCps.length === 0 ? (
              <div className="muted small checkpoints-empty">
                No checkpoints yet. Add one like “At T-30min: demo ready” or
                “At T-15min: record video.”
              </div>
            ) : (
              <ul className="checkpoint-list">
                {sortedCps.map((cp) => {
                  const passed = minsLeft <= cp.minsRemaining;
                  const cls = cp.done
                    ? "checkpoint-done"
                    : passed
                    ? "checkpoint-due"
                    : "checkpoint-pending";
                  return (
                    <li key={cp.id} className={`checkpoint ${cls}`}>
                      <button
                        className="cp-check"
                        onClick={() => toggleCheckpoint(cp.id)}
                        aria-label={cp.done ? "Mark not done" : "Mark done"}
                      >
                        {cp.done ? "✓" : ""}
                      </button>
                      <span className="cp-time mono">T-{cp.minsRemaining}m</span>
                      <span className="cp-text">{cp.label}</span>
                      <button
                        className="cp-remove"
                        onClick={() => removeCheckpoint(cp.id)}
                        aria-label="Remove"
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TimerSetup({
  hoursIn,
  setHoursIn,
  onStart,
}: {
  hoursIn: string;
  setHoursIn: (s: string) => void;
  onStart: (e: React.FormEvent) => void;
}) {
  return (
    <div className="timer-setup">
      <h2>No timer running</h2>
      <p className="muted">
        Start a hackathon timer manually here, or run <code>/grillme --hackathon 4</code> in
        Claude Code to start one from the skill side.
      </p>
      <form onSubmit={onStart} className="timer-setup-form">
        <input
          type="number"
          min="0.1"
          step="0.1"
          value={hoursIn}
          onChange={(e) => setHoursIn(e.target.value)}
          className="timer-setup-hours"
          autoFocus
        />
        <span className="muted">hours</span>
        <button type="submit" className="primary">Start timer</button>
      </form>
    </div>
  );
}
