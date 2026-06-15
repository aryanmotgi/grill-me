#!/usr/bin/env bash
# voice.sh — opt-in macOS TTS wrapper.
#
# Usage:
#   _shared/voice.sh "text to speak"
#
# Reads env var GRILLME_VOICE. If GRILLME_VOICE=1, runs `say` (macOS only).
# Otherwise no-ops silently. Never fails the calling phase.
set -euo pipefail

TEXT="${1:-}"
if [ -z "$TEXT" ]; then
  exit 0
fi

if [ "${GRILLME_VOICE:-0}" != "1" ]; then
  exit 0
fi

if ! command -v say >/dev/null 2>&1; then
  # not on macOS; silent no-op
  exit 0
fi

# Run in background so we don't block the prompt; ignore failures.
say "$TEXT" >/dev/null 2>&1 &
exit 0
