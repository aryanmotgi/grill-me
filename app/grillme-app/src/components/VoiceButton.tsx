// VoiceButton.tsx — Reusable mic button using the Web Speech API
// (webkitSpeechRecognition). Works inside the macOS WKWebView Tauri uses,
// with zero new native dependencies. Single-utterance flavor: starts on
// click, fires interim results as the user speaks, fires one final result
// then stops. Wire up via onTranscript(text, isFinal).

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  onTranscript: (text: string, isFinal: boolean) => void;
  lang?: string;
  className?: string;
  title?: string;
}

// Minimal shape of the SpeechRecognition we touch. Avoids needing the DOM
// lib's experimental types (they're not all present in @types/dom).
type SRInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
  onend: ((ev: any) => void) | null;
  onstart: ((ev: any) => void) | null;
};

type SRCtor = new () => SRInstance;

function getSpeechRecognitionCtor(): SRCtor | null {
  const w = window as any;
  return (w.webkitSpeechRecognition || w.SpeechRecognition || null) as SRCtor | null;
}

export default function VoiceButton({ onTranscript, lang = "en-US", className, title }: Props) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<SRInstance | null>(null);

  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  // Detach listeners + stop when component unmounts.
  useEffect(() => {
    return () => {
      const r = recRef.current;
      if (r) {
        r.onresult = null;
        r.onerror = null;
        r.onend = null;
        r.onstart = null;
        try {
          r.abort();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }

    // Build a fresh instance each session — re-using an aborted instance is
    // unreliable across WebKit versions.
    const r: SRInstance = new Ctor();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;

    r.onstart = () => setListening(true);

    r.onresult = (ev: any) => {
      let interim = "";
      let finalText = "";
      const results = ev.results || [];
      for (let i = ev.resultIndex || 0; i < results.length; i++) {
        const res = results[i];
        const transcript = (res[0] && res[0].transcript) || "";
        if (res.isFinal) finalText += transcript;
        else interim += transcript;
      }
      if (finalText) {
        onTranscript(finalText.trim(), true);
      } else if (interim) {
        onTranscript(interim.trim(), false);
      }
    };

    r.onerror = (ev: any) => {
      console.warn("[VoiceButton] recognition error:", ev?.error || ev);
      onTranscript("", true);
      setListening(false);
    };

    r.onend = () => {
      setListening(false);
    };

    recRef.current = r;
    try {
      r.start();
    } catch (e) {
      console.warn("[VoiceButton] start failed:", e);
      setListening(false);
    }
  }, [lang, onTranscript]);

  const stop = useCallback(() => {
    const r = recRef.current;
    if (!r) return;
    try {
      r.stop();
    } catch {
      /* noop */
    }
  }, []);

  const onClick = useCallback(() => {
    if (!supported) return;
    if (listening) stop();
    else start();
  }, [listening, start, stop, supported]);

  if (!supported) {
    return (
      <button
        type="button"
        className={className}
        disabled
        title="Voice input not supported in this runtime"
        aria-label="Voice input not supported"
        style={baseButtonStyle(false, false)}
      >
        🎤
      </button>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      title={title || (listening ? "Stop listening" : "Start voice input")}
      aria-label={listening ? "Stop voice input" : "Start voice input"}
      aria-pressed={listening}
      style={baseButtonStyle(true, listening)}
    >
      {listening ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={pulseDotStyle} />
          REC
        </span>
      ) : (
        <span aria-hidden>🎤</span>
      )}
      <style>{`
        @keyframes grillme-voice-pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(1.25); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </button>
  );
}

function baseButtonStyle(enabled: boolean, listening: boolean): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    minWidth: 32,
    borderRadius: "50%",
    border: listening ? "1.5px solid #e0526b" : "1px solid var(--border, #444)",
    background: listening ? "rgba(224, 82, 107, 0.12)" : "transparent",
    color: "inherit",
    cursor: enabled ? "pointer" : "not-allowed",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    padding: 0,
    opacity: enabled ? 1 : 0.5,
    transition: "background 120ms ease, border-color 120ms ease",
  };
}

const pulseDotStyle: React.CSSProperties = {
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "#e0526b",
  animation: "grillme-voice-pulse 1.1s ease-in-out infinite",
};
