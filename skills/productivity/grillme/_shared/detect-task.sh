#!/usr/bin/env bash
# detect-task.sh — inspect PLAN.md and emit codex flags string based on task type.
#
# Heuristic:
#   scaffold / new repo / empty repo / init  -> low effort
#   bug / fix / regression / broken          -> high effort
#   everything else (feature, refactor, etc) -> medium
#
# Usage:
#   _shared/detect-task.sh [path/to/PLAN.md]
# Prints a flag string suitable for appending to `codex exec`.
set -euo pipefail

PLAN_FILE="${1:-PLAN.md}"

effort="medium"

if [ -f "$PLAN_FILE" ]; then
  # lowercase grep for keywords; -E for alternation; -q quiet
  if grep -qiE '\b(scaffold|empty repo|new project|bootstrap|init project|from scratch)\b' "$PLAN_FILE"; then
    effort="low"
  fi
  if grep -qiE '\b(bug|fix|regression|broken|hotfix|crash|error|stack trace)\b' "$PLAN_FILE"; then
    effort="high"
  fi
fi

printf -- '-c model_reasoning_effort="%s"' "$effort"
