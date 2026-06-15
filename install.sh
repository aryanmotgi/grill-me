#!/usr/bin/env bash
# Install grillme-skill into Claude Code.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
TARGET="$CLAUDE_SKILLS_DIR/grillme"

mkdir -p "$CLAUDE_SKILLS_DIR"

if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  echo "Removing existing $TARGET"
  rm -rf "$TARGET"
fi

ln -s "$REPO_DIR/skill" "$TARGET"
echo "Linked $REPO_DIR/skill -> $TARGET"

# Check codex CLI
if ! command -v codex >/dev/null 2>&1; then
  echo ""
  echo "WARNING: codex CLI not found."
  echo "Install: npm i -g @openai/codex"
fi

echo ""
echo "Done. Restart Claude Code, then type /grillme in any project."
