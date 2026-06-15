# grillme-skill

Personal Claude Code plugin for vibe coders who plan with Claude Code and build with Codex.

Designed around one trigger: `/grillme`.

## Skills

### productivity

- [grillme](./skills/productivity/grillme/SKILL.md) — orient in your project, hard-grill your understanding, write a plan, hand off to Codex, then teach the diff back so you actually learn what was built.

## Install

### As a Claude Code plugin (preferred)

```
/plugin marketplace add <your-fork-url>
/plugin install grillme-skill
```

### Local symlink (dev)

```
git clone <repo> ~/code/grillme-skill
cd ~/code/grillme-skill
./install.sh
```

Restart Claude Code, then in any project: `/grillme`.

## Requires

- Claude Code
- `codex` CLI (`npm i -g @openai/codex`) for autorun. Optional — skill prints the prompt and tells you what to do if it's missing.

## Layout

```
.claude-plugin/plugin.json           plugin manifest
skills/
  productivity/
    grillme/
      SKILL.md                       loaded by Claude Code
      builds/                        prompts piped to `codex exec`
      plans/                         orient + grill + teach helpers
      templates/GRILLME.md           project memory template
install.sh                           dev-mode symlink to ~/.claude/skills
```

## Differences vs mattpocock/skills

His repo has its own one-paragraph `grill-me` skill and a separate `teach` skill. This repo bundles orient + grill + plan + Codex handoff + teach + ship into a single `/grillme` loop with project memory (`GRILLME.md`) so the next session picks up where you left off.
