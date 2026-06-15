#!/usr/bin/env bash
# Dev-mode install: symlink the grillme skill into ~/.claude/skills.
# For production use, install as a Claude Code plugin instead.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_SRC="$REPO_DIR/skills/productivity/grillme"
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
TARGET="$CLAUDE_SKILLS_DIR/grillme"

mkdir -p "$CLAUDE_SKILLS_DIR"

if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  echo "Removing existing $TARGET"
  rm -rf "$TARGET"
fi

ln -s "$SKILL_SRC" "$TARGET"
echo "Linked $SKILL_SRC -> $TARGET"

if ! command -v codex >/dev/null 2>&1; then
  echo ""
  echo "WARNING: codex CLI not found. Install with:"
  echo "  npm i -g @openai/codex"
fi

echo ""
echo "Done. Restart Claude Code, then type /grillme in any project."
