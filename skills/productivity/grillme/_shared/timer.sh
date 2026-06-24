#!/usr/bin/env bash
# timer.sh — compute "Xh Ym left" string for hackathon mode.
#
# Usage:
#   _shared/timer.sh <started_at_iso8601> <hackathon_hours>
#
# Prints something like "2h 14m left" or "OVERTIME 0h 12m" if past deadline.
set -euo pipefail

STARTED_AT="${1:-}"
HOURS="${2:-}"

if [ -z "$STARTED_AT" ] || [ -z "$HOURS" ]; then
  echo "usage: timer.sh <started_at_iso8601> <hackathon_hours>" >&2
  exit 1
fi

# Parse ISO 8601 -> epoch. macOS `date` needs -j -f.
if date -j -f "%Y-%m-%dT%H:%M:%SZ" "$STARTED_AT" "+%s" >/dev/null 2>&1; then
  start_epoch=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%SZ" "$STARTED_AT" "+%s")
else
  # GNU date fallback
  start_epoch=$(date -u -d "$STARTED_AT" "+%s")
fi

now_epoch=$(date -u "+%s")
deadline=$(( start_epoch + HOURS * 3600 ))
remaining=$(( deadline - now_epoch ))

if [ "$remaining" -lt 0 ]; then
  over=$(( -remaining ))
  h=$(( over / 3600 ))
  m=$(( (over % 3600) / 60 ))
  printf 'OVERTIME %dh %dm\n' "$h" "$m"
else
  h=$(( remaining / 3600 ))
  m=$(( (remaining % 3600) / 60 ))
  printf '%dh %dm left\n' "$h" "$m"
fi
