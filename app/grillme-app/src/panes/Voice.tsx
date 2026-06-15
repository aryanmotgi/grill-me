// Voice.tsx — dedicated voice dictation pane. Big mic toggle, live transcript,
// pipe-to-claude.ai button. Uses Web Speech API via VoiceButton; on macOS the
// underlying WKWebView routes audio through Safari's recognizer (cloud),
// which requires microphone permission. See VERIFY/notes below for the
// Info.plist key that needs to ride along.

import { useCallback, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import VoiceButton from "../components/VoiceButton";

type Lang = "en-US" | "es-ES" | "fr-FR";

const LANG_LABELS: Record<Lang, string> = {
  "en-US": "English (US)",
  "es-ES": "Español (ES)",
  "fr-FR": "Français (FR)",
};

export default function Voice() {
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("en-US");

  // Track listening externally so we can show "Listening…" without forcing
  // VoiceButton to expose its state. We do it via the timing of transcript
  // callbacks.
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const supported = useMemo(() => {
    const w = window as any;
    return !!(w.webkitSpeechRecognition || w.SpeechRecognition);
  }, []);

  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    if (!isFinal) {
      setInterim(text);
      setListening(true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setListening(false), 1500);
      return;
    }
    // Final result (or signaled end-on-error with empty string)
    if (text) {
      setTranscript((prev) => (prev ? prev + " " : "") + text);
    }
    setInterim("");
    setListening(false);
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);

  const sendToClaude = useCallback(async () => {
    const text = transcript.trim();
    if (!text) return;
    setError(null);
    setStatus(null);
    try {
      await invoke("bridge_to_claude", { text, send: true });
      setStatus("Sent to claude.ai");
    } catch (e) {
      const msg = String(e);
      // bridge_to_claude returns Err("Open Claude inline first") when the
      // embedded webview isn't mounted. Surface a friendly hint.
      if (/Open Claude/i.test(msg)) {
        setError("Open Claude.ai pane first, then return to Voice.");
      } else {
        setError(`Send failed: ${msg}`);
      }
    }
  }, [transcript]);

  const copyToClipboard = useCallback(async () => {
    const text = transcript.trim();
    if (!text) return;
    setError(null);
    setStatus(null);
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied to clipboard");
    } catch (e) {
      setError(`Copy failed: ${String(e)}`);
    }
  }, [transcript]);

  const clearAll = useCallback(() => {
    setTranscript("");
    setInterim("");
    setError(null);
    setStatus(null);
  }, []);

  const badge = !supported
    ? "Voice unsupported in this runtime"
    : listening
    ? "Listening…"
    : "Idle";

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "32px 24px",
        gap: 20,
        overflow: "auto",
      }}
    >
      <header style={{ width: "100%", maxWidth: 760, textAlign: "center" }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Voice</h2>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          Speak, then pipe the transcript into the embedded claude.ai composer.
        </p>
      </header>

      {/* Hero mic — wrap the small VoiceButton in a scaled container to make
          it ~96px without duplicating its lifecycle logic. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            transform: "scale(3)",
            transformOrigin: "center",
            padding: "32px 0",
          }}
        >
          <VoiceButton onTranscript={handleTranscript} lang={lang} />
        </div>
        <span
          style={{
            fontSize: 12,
            padding: "3px 10px",
            borderRadius: 999,
            border: "1px solid var(--border, #444)",
            background: listening ? "rgba(224, 82, 107, 0.12)" : "transparent",
            color: !supported ? "#c98" : listening ? "#e0526b" : "inherit",
          }}
          aria-live="polite"
        >
          {badge}
        </span>
      </div>

      {/* Language chip */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor="voice-lang" className="muted" style={{ fontSize: 12 }}>
          Language
        </label>
        <select
          id="voice-lang"
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          style={{
            fontSize: 12,
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid var(--border, #444)",
            background: "transparent",
            color: "inherit",
          }}
        >
          {(Object.keys(LANG_LABELS) as Lang[]).map((k) => (
            <option key={k} value={k}>
              {LANG_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      {/* Transcript display */}
      <div
        aria-live="polite"
        style={{
          width: "100%",
          maxWidth: 760,
          minHeight: 160,
          padding: 14,
          borderRadius: 8,
          border: "1px solid var(--border, #444)",
          background: "var(--panel, rgba(255,255,255,0.02))",
          fontSize: 15,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {transcript ? (
          <span>{transcript}</span>
        ) : (
          !interim && (
            <span className="muted" style={{ fontStyle: "italic" }}>
              Your dictation will appear here…
            </span>
          )
        )}
        {interim && (
          <span
            style={{
              color: "var(--muted, #888)",
              fontStyle: "italic",
              marginLeft: transcript ? 6 : 0,
            }}
          >
            {transcript ? " " : ""}
            {interim}
          </span>
        )}
      </div>

      {/* Action row */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <button
          type="button"
          className="primary"
          onClick={sendToClaude}
          disabled={!transcript.trim()}
          title="Inject the transcript into the embedded claude.ai composer and send"
        >
          Send to Claude.ai
        </button>
        <button
          type="button"
          onClick={copyToClipboard}
          disabled={!transcript.trim()}
        >
          Copy to clipboard
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={!transcript && !interim}
        >
          Clear
        </button>
      </div>

      {status && (
        <div
          className="banner"
          style={{
            width: "100%",
            maxWidth: 760,
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #2e7d4f",
            background: "rgba(46, 125, 79, 0.12)",
            color: "#7cc599",
            fontSize: 13,
          }}
        >
          {status}
        </div>
      )}

      {error && (
        <div
          className="banner"
          style={{
            width: "100%",
            maxWidth: 760,
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #b85c5c",
            background: "rgba(184, 92, 92, 0.12)",
            color: "#e89393",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
