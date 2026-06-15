import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import Welcome from "./Welcome";
import Sidebar from "./Sidebar";
import Projects from "./panes/Projects";
import ClaudeWeb from "./panes/ClaudeWeb";
import Timeline from "./panes/Timeline";
import Search from "./panes/Search";
import Cost from "./panes/Cost";
import Voice from "./panes/Voice";
import Overview from "./panes/Overview";
import Chat from "./panes/Chat";
import Timer from "./panes/Timer";
import Plan from "./panes/Plan";
import Learn from "./panes/Learn";
import Codex from "./panes/Codex";
import { GrillmeState, PaneName, StateChangedPayload, VersionMismatchPayload } from "./types";

const SUPPORTED_VERSION = 1;

export default function App() {
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [pane, setPane] = useState<PaneName>("projects");
  const [state, setState] = useState<GrillmeState | null>(null);
  const [planMd, setPlanMd] = useState("");
  const [learnedMd, setLearnedMd] = useState("");
  const [grillmeMd, setGrillmeMd] = useState("");
  const [versionError, setVersionError] = useState<string | null>(null);
  const [learnCount, setLearnCount] = useState(0);

  const applyFile = useCallback((file: string, content: string) => {
    if (file === ".grillme/state.json") {
      try {
        const parsed = JSON.parse(content) as GrillmeState;
        if (parsed.version !== SUPPORTED_VERSION) {
          setVersionError(
            `GrillMe.app expects state version ${SUPPORTED_VERSION} but found ${parsed.version}. Update the app.`
          );
          return;
        }
        setVersionError(null);
        setState(parsed);
      } catch (e) {
        console.warn("failed to parse state.json", e);
      }
    } else if (file === "PLAN.md") setPlanMd(content);
    else if (file === "LEARNED.md") setLearnedMd(content);
    else if (file === "GRILLME.md") setGrillmeMd(content);
  }, []);

  useEffect(() => {
    if (!projectRoot) return;

    let unlistenState: UnlistenFn | undefined;
    let unlistenVer: UnlistenFn | undefined;

    (async () => {
      unlistenState = await listen<StateChangedPayload>("state-changed", (e) => {
        applyFile(e.payload.file, e.payload.content);
      });
      unlistenVer = await listen<VersionMismatchPayload>("version-mismatch", (e) => {
        setVersionError(
          `GrillMe.app expects state version ${SUPPORTED_VERSION} but found ${JSON.stringify(e.payload.version)}. Update the app.`
        );
      });

      try {
        await invoke("start_watch", { projectRoot });
      } catch (e) {
        console.error("start_watch failed", e);
      }
    })();

    return () => {
      unlistenState?.();
      unlistenVer?.();
      invoke("stop_watch").catch(() => {});
    };
  }, [projectRoot, applyFile]);

  // Defensive: hide the claude.ai inline window whenever the active pane is
  // not the Claude.ai pane. Backed by a top-level WebviewWindow now, so
  // hide() reliably maps to NSWindow.orderOut: on macOS.
  useEffect(() => {
    if (pane !== "claude-web") {
      invoke("hide_claude_inline").catch(() => {});
    }
  }, [pane]);

  // Keyboard shortcuts Cmd+1..6
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (!ev.metaKey) return;
      const map: Record<string, PaneName> = {
        "1": "projects",
        "2": "overview",
        "3": "timer",
        "4": "plan",
        "5": "learn",
        "6": "codex",
      };
      const target = map[ev.key];
      if (target) {
        ev.preventDefault();
        setPane(target);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function switchProject() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await invoke("save_recent_project", { path: selected });
      setState(null);
      setPlanMd("");
      setLearnedMd("");
      setGrillmeMd("");
      setVersionError(null);
      setProjectRoot(selected);
    }
  }

  if (!projectRoot) {
    return <Welcome onPick={setProjectRoot} />;
  }

  return (
    <div className="app">
      <Sidebar state={state} projectRoot={projectRoot} active={pane} learnCount={learnCount} onSelect={setPane} onSwitchProject={switchProject} />
      <main className="main" aria-label={`${pane} pane`}>
        {versionError && <div className="banner">{versionError}</div>}
        {pane === "projects" && <Projects projectRoot={projectRoot} />}
        {pane === "claude-web" && <ClaudeWeb />}
        {pane === "timeline" && <Timeline />}
        {pane === "search" && <Search />}
        {pane === "cost" && <Cost />}
        {pane === "voice" && <Voice />}
        {pane === "overview" && <Overview state={state} grillmeMd={grillmeMd} />}
        {pane === "chat" && <Chat projectRoot={projectRoot} />}
        {pane === "timer" && <Timer state={state} />}
        {pane === "plan" && <Plan state={state} planMd={planMd} />}
        {pane === "learn" && <Learn learnedMd={learnedMd} onCountChange={setLearnCount} />}
        {pane === "codex" && <Codex state={state} grillmeMd={grillmeMd} />}
      </main>
    </div>
  );
}
