#!/usr/bin/env bash
# write-state.sh — atomically write JSON from stdin to .grillme/state.json
#
# Usage:
#   echo '{...}' | _shared/write-state.sh [project_root]
#
# If no project_root passed, uses current working directory.
# Schema must include "version": 1.
set -euo pipefail

PROJECT_ROOT="${1:-$PWD}"
STATE_DIR="$PROJECT_ROOT/.grillme"
STATE_FILE="$STATE_DIR/state.json"
TMP_FILE="$STATE_DIR/state.json.tmp"

mkdir -p "$STATE_DIR"

# Read JSON from stdin to tmp, then atomic rename (POSIX mv on same fs is atomic).
cat > "$TMP_FILE"

# Sanity: tmp must be non-empty.
if [ ! -s "$TMP_FILE" ]; then
  rm -f "$TMP_FILE"
  echo "write-state.sh: refusing to write empty state.json" >&2
  exit 1
fi

# Sanity: must contain "version": 1
if ! grep -q '"version"[[:space:]]*:[[:space:]]*1' "$TMP_FILE"; then
  rm -f "$TMP_FILE"
  echo "write-state.sh: state JSON missing required \"version\": 1 field" >&2
  exit 1
fi

mv "$TMP_FILE" "$STATE_FILE"
echo "$STATE_FILE"
