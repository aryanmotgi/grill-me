#!/usr/bin/env bash
# append-learned.sh — append a learning entry to LEARNED.md in project root.
#
# Usage:
#   _shared/append-learned.sh "<concept>" "<explanation>" [file:line] [project_root]
#
# All args after concept+explanation optional. If project_root omitted, uses cwd.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: append-learned.sh <concept> <explanation> [file:line] [project_root]" >&2
  exit 1
fi

CONCEPT="$1"
EXPLANATION="$2"
REF="${3:-}"
PROJECT_ROOT="${4:-$PWD}"
LEARNED_FILE="$PROJECT_ROOT/LEARNED.md"
DATE="$(date -u +"%Y-%m-%d")"

if [ ! -f "$LEARNED_FILE" ]; then
  printf '# LEARNED\n\nThings the user nailed in /grillme quizzes. Newest first.\n\n' > "$LEARNED_FILE"
fi

# Build entry
{
  printf '## %s — %s\n' "$CONCEPT" "$DATE"
  if [ -n "$REF" ]; then
    printf '\n_ref: `%s`_\n' "$REF"
  fi
  printf '\n%s\n\n' "$EXPLANATION"
} >> "$LEARNED_FILE"

echo "$LEARNED_FILE"
