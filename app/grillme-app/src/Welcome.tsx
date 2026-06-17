import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface Props {
  onPick: (path: string) => void;
}

export default function Welcome({ onPick }: Props) {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    invoke<string[]>("get_recent_projects")
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  async function pick() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await invoke("save_recent_project", { path: selected });
      onPick(selected);
    }
  }

  return (
    <div className="welcome">
      <div className="logo">G</div>
      <h1>Welcome to GrillMe</h1>
      <p>Your live dashboard for vibe-coding sessions. Pick a project to begin.</p>
      <button className="primary" onClick={pick}>Pick project folder</button>
      <p className="tip">
        Tip: run <code>/grillme</code> in Claude Code on your project first — that creates the state
        file this dashboard reads.
      </p>
      {recent.length > 0 && (
        <div className="recent">
          <h3>Recent</h3>
          {recent.map((p) => (
            <button key={p} onClick={() => onPick(p)} title={p}>
              {p.split("/").slice(-2).join("/")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
