import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { marked } from "marked";

interface Props {
  projectRoot: string | null;
}

type ChatEntry =
  | { role: "user"; text: string; ts: string }
  | { role: "assistant"; text: string; ts: string; streaming?: boolean }
  | { role: "system"; text: string; ts: string }
  | { role: "tool"; text: string; ts: string };

interface SidecarEvent {
  // SDK messages have varying shapes; we use a permissive type.
  type: string;
  subtype?: string;
  message?: any;
  session_id?: string;
  cwd?: string;
  // turn_done / error / ready surface their own fields:
  result?: any;
  error?: any;
  // From the sidecar's own envelopes:
  message_field?: string;
}

function nowISO(): string {
  return new Date().toISOString();
}

function renderMd(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

/**
 * Extract the human-readable text from one streamed SDK message. The SDK
 * surfaces both raw assistant content blocks and synthesized result events;
 * we only render what carries text.
 */
function textFromSDKMessage(ev: any): string | null {
  if (ev?.type === "assistant" && ev?.message?.content) {
    const parts: string[] = [];
    for (const block of ev.message.content) {
      if (block?.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
    return parts.join("\n");
  }
  if (ev?.type === "result" && typeof ev?.result === "string") {
    return ev.result;
  }
  return null;
}

function toolNameFromSDKMessage(ev: any): string | null {
  if (ev?.type === "assistant" && ev?.message?.content) {
    for (const block of ev.message.content) {
      if (block?.type === "tool_use" && typeof block.name === "string") {
        return block.name;
      }
    }
  }
  return null;
}

export default function Chat({ projectRoot }: Props) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("starting…");
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const turnAssistantBufRef = useRef<string>("");

  // Start the sidecar when the pane mounts (and a project is picked).
  useEffect(() => {
    if (!projectRoot) {
      setStatus("no project");
      return;
    }
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    (async () => {
      try {
        unlisten = await listen<{ payload: SidecarEvent }>("chat-event", (e) => {
          handleEvent(e.payload.payload);
        });

        await invoke("start_chat", { projectRoot });
        if (!cancelled) setStatus("ready");
      } catch (e) {
        const msg = String(e);
        setError(msg);
        setStatus("failed");
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      invoke("stop_chat").catch(() => {});
    };
  }, [projectRoot]);

  // Auto-scroll to bottom on new entries.
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [entries.length]);

  function handleEvent(ev: SidecarEvent) {
    if (ev.type === "ready") {
      setStatus(`ready · ${ev.cwd ?? ""}`);
      return;
    }
    if (ev.type === "error") {
      const msg = (ev as any).message ?? "unknown error";
      setEntries((prev) => [
        ...prev,
        { role: "system", text: `Error: ${msg}`, ts: nowISO() },
      ]);
      setBusy(false);
      return;
    }
    if (ev.type === "turn_done") {
      // Flush any buffered assistant text as a finalized entry.
      const buf = turnAssistantBufRef.current;
      if (buf.trim()) {
        setEntries((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            return [
              ...prev.slice(0, -1),
              { role: "assistant", text: buf, ts: last.ts },
            ];
          }
          return [...prev, { role: "assistant", text: buf, ts: nowISO() }];
        });
      }
      turnAssistantBufRef.current = "";
      setBusy(false);
      return;
    }

    // Assistant content block: append to streaming buffer.
    const text = textFromSDKMessage(ev);
    if (text != null) {
      turnAssistantBufRef.current = turnAssistantBufRef.current
        ? turnAssistantBufRef.current + "\n" + text
        : text;
      setEntries((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.streaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, text: turnAssistantBufRef.current },
          ];
        }
        return [
          ...prev,
          {
            role: "assistant",
            text: turnAssistantBufRef.current,
            ts: nowISO(),
            streaming: true,
          },
        ];
      });
      return;
    }

    // Tool use → log as an inline pill so the user can see actions.
    const tool = toolNameFromSDKMessage(ev);
    if (tool) {
      setEntries((prev) => [
        ...prev,
        { role: "tool", text: tool, ts: nowISO() },
      ]);
    }
  }

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");
    setBusy(true);
    turnAssistantBufRef.current = "";
    setEntries((prev) => [...prev, { role: "user", text, ts: nowISO() }]);
    try {
      await invoke("send_chat_message", { text });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }, [input, busy]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd+Enter or Ctrl+Enter sends.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void send();
    }
  }

  function interrupt() {
    invoke("interrupt_chat").catch(() => {});
  }

  if (!projectRoot) {
    return (
      <div className="empty">
        Pick a project to start chatting with Claude here.
      </div>
    );
  }

  return (
    <div className="chat-pane">
      <div className="chat-status mono">
        <span className={`chat-dot ${status.startsWith("ready") ? "ok" : status === "failed" ? "err" : "wait"}`} />
        {status}
        {busy && <span className="chat-busy">· thinking…</span>}
      </div>

      {error && <div className="banner">{error}</div>}

      <div className="chat-scroller" ref={scrollerRef}>
        {entries.length === 0 ? (
          <div className="chat-empty muted">
            Type below to send a message. Claude has full access to this project
            and can edit files — changes will light up other panes live.
          </div>
        ) : (
          entries.map((e, i) => <ChatBubble key={i} entry={e} />)
        )}
      </div>

      <div className="chat-composer">
        <textarea
          value={input}
          placeholder="Message Claude. Cmd+Enter to send."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
        />
        <div className="chat-composer-actions">
          {busy ? (
            <button onClick={interrupt} className="chat-interrupt">
              Stop
            </button>
          ) : (
            <button onClick={send} className="primary" disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ entry }: { entry: ChatEntry }) {
  if (entry.role === "system") {
    return <div className="chat-system">{entry.text}</div>;
  }
  if (entry.role === "tool") {
    return (
      <div className="chat-tool">
        <span className="chat-tool-name mono">{entry.text}</span>
      </div>
    );
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
