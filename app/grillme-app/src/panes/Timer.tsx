import { useEffect, useRef, useState } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { GrillmeState } from "../types";

interface Props {
  state: GrillmeState | null;
}

const MILESTONES: { mins: number; label: string }[] = [
  { mins: 180, label: "3 hours remaining" },
  { mins: 120, label: "2 hours remaining" },
  { mins: 60, label: "1 hour remaining" },
  { mins: 30, label: "30 minutes remaining" },
  { mins: 10, label: "10 minutes remaining" },
];

function fmt(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Timer({ state }: Props) {
  const [now, setNow] = useState(Date.now());
  const firedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Reset fired milestones when session changes.
    firedRef.current = new Set();
  }, [state?.started_at]);

  if (!state) {
    return (
      <div className="empty">
        No active session. Run <code>/grillme --hackathon 4</code> in Claude Code to start.
      </div>
    );
  }

  const start = new Date(state.started_at).getTime();
  const endMs = start + state.hackathon_hours * 3600 * 1000;
  const remaining = endMs - now;
  const minsLeft = remaining / 60000;

  // Notifications
  useNotifyMilestones(minsLeft, firedRef);

  let cls = "timer-green";
  if (minsLeft < 5) cls = "timer-red timer-pulse";
  else if (minsLeft < 30) cls = "timer-red";
  else if (minsLeft < 60) cls = "timer-amber";

  const startedLocal = new Date(state.started_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div>
      <div className={`timer-display ${cls}`}>{fmt(remaining)}</div>
      <div className="timer-sub">
        Started: {startedLocal} · Phase {state.phase_num}/6
        {state.current_step && state.total_steps
          ? ` · Step ${state.current_step} of ${state.total_steps}`
          : ""}
      </div>
    </div>
  );
}

function useNotifyMilestones(minsLeft: number, firedRef: React.MutableRefObject<Set<number>>) {
  useEffect(() => {
    for (const m of MILESTONES) {
      if (minsLeft <= m.mins && !firedRef.current.has(m.mins) && minsLeft > 0) {
        firedRef.current.add(m.mins);
        (async () => {
          try {
            let ok = await isPermissionGranted();
            if (!ok) ok = (await requestPermission()) === "granted";
            if (ok) {
              sendNotification({ title: "GrillMe", body: m.label });
            }
          } catch (e) {
            console.warn("notification failed", e);
          }
        })();
      }
    }
  }, [Math.floor(minsLeft)]);
}
