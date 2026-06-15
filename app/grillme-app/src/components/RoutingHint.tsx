import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface HintData {
  recommended: "cli" | "web" | "either";
  confidence: number;
  cli_score: number;
  web_score: number;
  reasons: string[];
}

interface Props {
  text: string;
  debounceMs?: number;
  onPick?: (target: "cli" | "web") => void;
}

const CLI_CHIP_STYLE: React.CSSProperties = {
  background: "rgba(74, 222, 128, 0.12)",
  color: "#4ade80",
  border: "1px solid rgba(74, 222, 128, 0.3)",
  borderRadius: 10,
  padding: "2px 8px",
  fontSize: 11,
  lineHeight: "16px",
  cursor: "pointer",
  fontFamily: "inherit",
};

const WEB_CHIP_STYLE: React.CSSProperties = {
  background: "rgba(255, 153, 128, 0.12)",
  color: "#ff9980",
  border: "1px solid rgba(255, 153, 128, 0.3)",
  borderRadius: 10,
  padding: "2px 8px",
  fontSize: 11,
  lineHeight: "16px",
  cursor: "pointer",
  fontFamily: "inherit",
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  color: "#9ca3af",
  lineHeight: "16px",
  flexWrap: "wrap",
};

export default function RoutingHint({ text, debounceMs = 300, onPick }: Props) {
  const [hint, setHint] = useState<HintData | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!text || text.trim().length < 3) {
      setHint(null);
      return;
    }
    const timer = setTimeout(() => {
      const myId = ++reqIdRef.current;
      invoke<HintData>("classify_prompt", { text })
        .then((result) => {
          if (reqIdRef.current === myId) {
            setHint(result);
          }
        })
        .catch(() => {
          if (reqIdRef.current === myId) {
            setHint(null);
          }
        });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [text, debounceMs]);

  if (!hint) return null;

  const pct = Math.round(hint.confidence * 100);
  const topReasons = hint.reasons.slice(0, 2).join(" - ");

  if (hint.recommended === "either") {
    return (
      <div style={ROW_STYLE} aria-label="routing suggestion">
        <span style={{ opacity: 0.7 }}>Either works:</span>
        <button
          type="button"
          aria-label="Try Claude Code CLI"
          style={CLI_CHIP_STYLE}
          onClick={() => onPick?.("cli")}
        >
          Try CLI
        </button>
        <button
          type="button"
          aria-label="Try claude.ai web"
          style={WEB_CHIP_STYLE}
          onClick={() => onPick?.("web")}
        >
          Try claude.ai
        </button>
        {topReasons && <span style={{ opacity: 0.6 }}>{topReasons}</span>}
      </div>
    );
  }

  const isCli = hint.recommended === "cli";
  const chipStyle = isCli ? CLI_CHIP_STYLE : WEB_CHIP_STYLE;
  const label = isCli ? "Send to CLI" : "Send to claude.ai";
  const ariaLabel = isCli
    ? `Recommended: Claude Code CLI (${pct}% confidence)`
    : `Recommended: claude.ai web (${pct}% confidence)`;

  return (
    <div style={ROW_STYLE} aria-label="routing suggestion">
      <button
        type="button"
        aria-label={ariaLabel}
        style={chipStyle}
        onClick={() => onPick?.(isCli ? "cli" : "web")}
      >
        {label}
      </button>
      <span style={{ opacity: 0.7 }}>{pct}%</span>
      {topReasons && <span style={{ opacity: 0.6 }}>{topReasons}</span>}
    </div>
  );
}
