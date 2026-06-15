// Projects.tsx — universal folder/chat picker with 3-screen state machine.
//
// Screen A: pick a folder (browse, recent folders, known Claude Code folders)
// Screen B: pick a chat in that folder (or start a new one)
// Screen C: transcript for the active chat — sidecar-bound to the folder cwd
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { marked } from "marked";

interface ClaudeProject {
  encoded_dir: string;
  cwd: string;
  display_name: string;
  session_count: number;
  latest_session_ts: string | null;
}

interface ClaudeSession {
  session_id: string;
  encoded_dir: string;
  cwd: string;
  title: string;
  first_user_message: string | null;
  first_ts: string | null;
  last_ts: string | null;
  message_count: number;
}

interface ClaudeMessage {
  uuid: string | null;
  parent_uuid: string | null;
  ts: string | null;
  role: string;
  text: string | null;
  tool_name: string | null;
  tool_input: any;
  raw_type: string;
}

interface LiveEntry {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  ts: string;
  streaming?: boolean;
}

type Screen = "folder" | "chat" | "transcript";

function renderMd(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(t).toLocaleDateString();
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function textFromSDKMessage(ev: any): string | null {
  if (ev?.type === "assistant" && ev?.message?.content) {
    const parts: string[] = [];
    for (const block of ev.message.content) {
      if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
    }
    if (parts.length === 0) return null;
    return parts.join("\n");
  }
  if (ev?.type === "result" && typeof ev?.result === "string") return ev.result;
  return null;
}

function toolNameFromSDK(ev: any): string | null {
  if (ev?.type === "assistant" && ev?.message?.content) {
    for (const block of ev.message.content) {
      if (block?.type === "tool_use" && typeof block.name === "string") return block.name;
    }
  }
  return null;
}

interface ProjectsProps {
  projectRoot?: string | null;
}

export default function Projects({ projectRoot }: ProjectsProps = {}) {
  // Navigation state — auto-bind to the project the user picked at app start.
  // The Welcome screen already selected a folder; making them re-pick here is
  // redundant. "Switch folder" still exposes Screen A on demand.
  const initialFolder = projectRoot
    ? { cwd: projectRoot, display_name: basename(projectRoot) }
    : null;
  const [screen, setScreen] = useState<Screen>(initialFolder ? "chat" : "folder");
  const [folder, setFolder] = useState<{ cwd: string; display_name: string } | null>(initialFolder);
  const [chat, setChat] = useState<ClaudeSession | null>(null);

  // Data state
  const [chatsForFolder, setChatsForFolder] = useState<ClaudeSession[]>([]);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [knownProjects, setKnownProjects] = useState<ClaudeProject[]>([]);

  // Transcript state
  const [history, setHistory] = useState<ClaudeMessage[]>([]);
  const [live, setLive] = useState<LiveEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatStatus, setChatStatus] = useState<"idle" | "starting" | "ready" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const turnAssistantBufRef = useRef<string>("");
  const sidecarStarted = useRef<string | null>(null);

  // ---- Screen A: load recent folders + known projects ----
  const loadFolderScreen = useCallback(async () => {
    try {
      const [recents, known] = await Promise.all([
        invoke<string[]>("get_recent_projects").catch(() => [] as string[]),
        invoke<ClaudeProject[]>("list_claude_projects").catch(() => [] as ClaudeProject[]),
      ]);
      setRecentFolders(recents.slice(0, 10));
      const sorted = [...known].sort((a, b) =>
        (b.latest_session_ts ?? "").localeCompare(a.latest_session_ts ?? "")
      );
      setKnownProjects(sorted);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (screen === "folder") {
      void loadFolderScreen();
    }
  }, [screen, loadFolderScreen]);

  // ---- Screen B: load chats for the active folder ----
  const loadChatsForFolder = useCallback(async (cwd: string) => {
    try {
      const list = await invoke<ClaudeSession[]>("find_chats_for_folder", { cwd }).catch(
        () => [] as ClaudeSession[]
      );
      const sorted = [...list].sort((a, b) =>
        (b.last_ts ?? "").localeCompare(a.last_ts ?? "")
      );
      setChatsForFolder(sorted);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (screen === "chat" && folder) {
      void loadChatsForFolder(folder.cwd);
    }
  }, [screen, folder?.cwd, loadChatsForFolder]);

  // ---- Folder picker actions ----
  async function pickFolderDialog() {
    try {
      const picked = await invoke<string | null>("pick_folder_dialog");
      if (picked) {
        await chooseFolder(picked);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseFolder(cwd: string, display?: string) {
    try {
      await invoke("save_recent_project", { path: cwd }).catch(() => {});
    } catch {
      /* noop */
    }
    setFolder({ cwd, display_name: display ?? basename(cwd) });
    setChat(null);
    setHistory([]);
    setLive([]);
    setError(null);
    setScreen("chat");
  }

  // ---- Sidecar bind for transcript screen ----
  useEffect(() => {
    if (screen !== "transcript" || !folder) return;
    if (sidecarStarted.current === folder.cwd) return;

    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    (async () => {
      try {
        setChatStatus("starting");
        unlisten = await listen<{ payload: any }>("chat-event", (e) => {
          handleSidecarEvent(e.payload.payload);
        });
        await invoke("start_chat", { projectRoot: folder.cwd });
        sidecarStarted.current = folder.cwd;
        if (!cancelled) setChatStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setChatStatus("failed");
        }
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [screen, folder?.cwd]);

  // ---- Load transcript history when entering Screen C with an existing chat ----
  useEffect(() => {
    if (screen !== "transcript") return;
    if (!chat) {
      setHistory([]);
      setLive([]);
      turnAssistantBufRef.current = "";
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const msgs = await invoke<ClaudeMessage[]>("read_claude_session", {
          encodedDir: chat.encoded_dir,
          sessionId: chat.session_id,
        });
        if (!cancelled) {
          setHistory(msgs);
          setLive([]);
          turnAssistantBufRef.current = "";
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, chat?.session_id]);

  // Auto-scroll bottom on new content.
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [history.length, live.length]);

  function handleSidecarEvent(ev: any) {
    if (ev.type === "error") {
      setLive((prev) => [
        ...prev,
        { role: "system", text: `Error: ${ev.message ?? "unknown"}`, ts: new Date().toISOString() },
      ]);
      setBusy(false);
      return;
    }
    if (ev.type === "turn_done") {
      const buf = turnAssistantBufRef.current;
      if (buf.trim()) {
        setLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            return [...prev.slice(0, -1), { ...last, text: buf, streaming: false }];
          }
          return [
            ...prev,
            { role: "assistant", text: buf, ts: new Date().toISOString(), streaming: false },
          ];
        });
      }
      turnAssistantBufRef.current = "";
      if (ev.session_id && chat && ev.session_id !== chat.session_id) {
        setChat({ ...chat, session_id: ev.session_id });
      }
      setBusy(false);
      return;
    }
    const text = textFromSDKMessage(ev);
    if (text != null) {
      turnAssistantBufRef.current = turnAssistantBufRef.current
        ? turnAssistantBufRef.current + "\n" + text
        : text;
      setLive((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.streaming) {
          return [...prev.slice(0, -1), { ...last, text: turnAssistantBufRef.current }];
        }
        return [
          ...prev,
          {
            role: "assistant",
            text: turnAssistantBufRef.current,
            ts: new Date().toISOString(),
            streaming: true,
          },
        ];
      });
      return;
    }
    const tool = toolNameFromSDK(ev);
    if (tool) {
      setLive((prev) => [
        ...prev,
        { role: "tool", text: tool, ts: new Date().toISOString() },
      ]);
    }
  }

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !folder) return;
    setError(null);
    setInput("");
    setBusy(true);
    turnAssistantBufRef.current = "";
    setLive((prev) => [
      ...prev,
      { role: "user", text, ts: new Date().toISOString() },
    ]);
    try {
      await invoke("send_chat_message", {
        text,
        sessionId: chat?.session_id ?? null,
        cwd: folder.cwd,
      });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }, [input, busy, folder, chat]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void send();
    }
  }

  function interrupt() {
    invoke("interrupt_chat").catch(() => {});
  }

  function openChat(session: ClaudeSession) {
    setChat(session);
    setScreen("transcript");
  }

  function startNewChat() {
    setChat(null);
    setHistory([]);
    setLive([]);
    turnAssistantBufRef.current = "";
    setError(null);
    setScreen("transcript");
  }

  function backToFolder() {
    setScreen("folder");
  }

  function backToChats() {
    setScreen("chat");
  }

  const mergedView = useMemo(() => ({ history, live }), [history, live]);

  // ---------------- RENDER ----------------

  if (screen === "folder") {
    return (
      <div className="folder-picker">
        <header className="folder-picker-head">
          <h2>Pick a folder</h2>
          <button className="primary" onClick={pickFolderDialog}>
            Browse folder…
          </button>
        </header>

        {error && <div className="banner">{error}</div>}

        <section className="folder-picker-section">
          <h3>Recent folders</h3>
          {recentFolders.length === 0 ? (
            <div className="muted small cc-section-empty">No recent folders yet.</div>
          ) : (
            <div className="folder-list">
              {recentFolders.map((p) => (
                <button
                  key={p}
                  className="folder-item"
                  onClick={() => chooseFolder(p)}
                  title={p}
                >
                  <span className="folder-item-name">{basename(p)}</span>
                  <span className="folder-item-path mono">{p}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="folder-picker-section">
          <h3>Known Claude Code folders</h3>
          {knownProjects.length === 0 ? (
            <div className="muted small cc-section-empty">
              No Claude Code projects at ~/.claude/projects.
            </div>
          ) : (
            <div className="folder-list">
              {knownProjects.map((p) => (
                <button
                  key={p.encoded_dir}
                  className="folder-item"
                  onClick={() => chooseFolder(p.cwd, p.display_name)}
                  title={p.cwd}
                >
                  <span className="folder-item-name">{p.display_name}</span>
                  <span className="folder-item-meta mono">
                    {p.session_count} chats · {relTime(p.latest_session_ts)}
                  </span>
                  <span className="folder-item-path mono">{p.cwd}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  if (screen === "chat" && folder) {
    return (
      <div className="folder-picker">
        <header className="folder-picker-head">
          <div className="crumbs">
            <button className="crumb" onClick={backToFolder}>
              ‹ Switch folder
            </button>
            <span className="crumb-current">{folder.display_name}</span>
          </div>
          <button className="primary" onClick={startNewChat}>
            + New chat
          </button>
        </header>

        {error && <div className="banner">{error}</div>}

        <section className="folder-picker-section">
          <h3>Chats in this folder</h3>
          {chatsForFolder.length === 0 ? (
            <div className="muted small cc-section-empty">No chats yet — start one.</div>
          ) : (
            <div className="folder-list">
              {chatsForFolder.map((s) => (
                <button
                  key={s.session_id}
                  className="folder-item"
                  onClick={() => openChat(s)}
                  title={s.title}
                >
                  <span className="folder-item-name">{s.title}</span>
                  <span className="folder-item-meta mono">
                    {s.message_count} msgs · {relTime(s.last_ts)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  // screen === "transcript"
  return (
    <div className="transcript-pane">
      <div className="cc-head">
        <div className="crumbs">
          <button className="crumb" onClick={backToFolder}>
            ‹ Folder
          </button>
          <span className="crumb-current">{folder?.display_name}</span>
          <span className="cc-head-sep">/</span>
          <button className="crumb" onClick={backToChats}>
            ‹ Chats
          </button>
          <span className="crumb-current">{chat ? chat.title : "New chat"}</span>
        </div>
        <div className="cc-status mono">
          <span
            className={`chat-dot ${chatStatus === "ready" ? "ok" : chatStatus === "failed" ? "err" : "wait"}`}
          />
          {chatStatus}
        </div>
      </div>

      {error && <div className="banner">{error}</div>}

      <div className="cc-chat-scroller" ref={scrollerRef}>
        {!chat && live.length === 0 && (
          <div className="cc-empty">
            <p className="muted">
              New chat in <code>{folder?.cwd}</code>. Cmd+Enter to send.
            </p>
          </div>
        )}

        {mergedView.history
          .filter((m) => m.role !== "system" || (m.text && m.text.length < 400))
          .map((m, i) => (
            <HistoryBubble key={`h${i}`} msg={m} />
          ))}

        {mergedView.live.map((e, i) => (
          <LiveBubble key={`l${i}`} entry={e} />
        ))}
      </div>

      <div className="cc-composer">
        <textarea
          value={input}
          placeholder={
            chat
              ? "Continue this chat. Cmd+Enter to send."
              : "Start a new chat in this folder. Cmd+Enter to send."
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
        />
        <div className="cc-composer-actions">
          {busy ? (
            <button onClick={interrupt} className="chat-interrupt">
              Stop
            </button>
          ) : (
            <button
              onClick={send}
              className="primary"
              disabled={!input.trim() || chatStatus !== "ready"}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryBubble({ msg }: { msg: ClaudeMessage }) {
  if (msg.role === "user" || msg.role === "assistant") {
    if (!msg.text) {
      if (msg.tool_name) {
        return (
          <div className="chat-tool">
            <span className="chat-tool-name mono">{msg.tool_name}</span>
          </div>
        );
      }
      return null;
    }
    return (
      <div className={`chat-msg chat-msg-${msg.role}`}>
        <div className="chat-msg-role mono">{msg.role}</div>
        <div
          className="chat-msg-body markdown"
          dangerouslySetInnerHTML={{ __html: renderMd(msg.text) }}
        />
      </div>
    );
  }
  if (msg.role === "system" && msg.text) {
    return <div className="chat-system">{msg.text.slice(0, 280)}</div>;
  }
  return null;
}

function LiveBubble({ entry }: { entry: LiveEntry }) {
  if (entry.role === "tool") {
    return (
      <div className="chat-tool">
        <span className="chat-tool-name mono">{entry.text}</span>
      </div>
    );
  }
  if (entry.role === "system") {
    return <div className="chat-system">{entry.text}</div>;
  }
  return (
    <div className={`chat-msg chat-msg-${entry.role}`}>
      <div className="chat-msg-role mono">{entry.role}</div>
      <div
        className="chat-msg-body markdown"
        dangerouslySetInnerHTML={{ __html: renderMd(entry.text) }}
      />
    </div>
  );
}
