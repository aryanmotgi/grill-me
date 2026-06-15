#!/usr/bin/env node
// chat.mjs — Claude Agent SDK sidecar for GrillMe.app.
//
// Protocol (line-delimited JSON over stdin/stdout):
//   stdin  → { "type": "user", "text": "..." }
//          → { "type": "interrupt" }
//          → { "type": "shutdown" }
//   stdout → { "type": "ready", "cwd": "..." }
//          → SDK message objects (system, assistant, user, result, ...)
//          → { "type": "turn_done", "session_id": "..." }
//          → { "type": "error", "message": "..." }
//
// CLI:
//   node chat.mjs <project_root>
//
// The sidecar maintains the session_id between turns by passing
// `resume: sessionId` to subsequent query() calls. Auth comes from the
// user's existing Claude Code login (~/.claude/config) or ANTHROPIC_API_KEY.
import { query } from "@anthropic-ai/claude-agent-sdk";
import readline from "node:readline";

const cwd = process.argv[2] || process.cwd();
let sessionId = null;
let activeQuery = null;

function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

function emitError(message, extra = {}) {
  emit({ type: "error", message: String(message), ...extra });
}

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    emitError(`malformed stdin line: ${e.message}`);
    return;
  }

  if (req.type === "shutdown") {
    process.exit(0);
  }

  if (req.type === "interrupt") {
    if (activeQuery) {
      try {
        await activeQuery.interrupt();
      } catch (e) {
        emitError(`interrupt failed: ${e.message}`);
      }
    }
    return;
  }

  if (req.type === "set_session") {
    // Frontend sets which existing Claude Code session to resume next turn.
    sessionId = typeof req.session_id === "string" ? req.session_id : null;
    emit({ type: "session_set", session_id: sessionId });
    return;
  }

  if (req.type !== "user" || typeof req.text !== "string") {
    emitError("expected { type: 'user', text: string }");
    return;
  }

  // Per-message resume override (if frontend sends one explicitly).
  if (typeof req.session_id === "string" && req.session_id) {
    sessionId = req.session_id;
  }

  try {
    activeQuery = query({
      prompt: req.text,
      options: {
        cwd: req.cwd || cwd,
        resume: sessionId ?? undefined,
        // The Tauri app already runs locally as the user — give the SDK the
        // same trust the user has when running `claude` in a terminal.
        permissionMode: "bypassPermissions",
      },
    });

    for await (const msg of activeQuery) {
      emit(msg);

      if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
        sessionId = msg.session_id;
      }

      if (msg.type === "result") {
        emit({ type: "turn_done", session_id: sessionId });
        break;
      }
    }
  } catch (e) {
    emitError(`query failed: ${e?.message ?? e}`);
  } finally {
    activeQuery = null;
  }
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

emit({ type: "ready", cwd });
