# grillme-skill

Personal coding coach for Claude Code. Triggered by `/grillme`.

Built for vibe coders who:
- juggle many hackathon projects and lose track
- want to learn what their AI-written code actually does
- plan with Claude Code, build with Codex

## What it does

Six phases per session:

1. **Orient** — reads `GRILLME.md` + git state, tells you where you left off
2. **Grill** — asks hard questions until you can explain your own plan
3. **Plan** — writes `PLAN.md` you approve
4. **Hand off** — runs `codex exec --full-auto` with the plan
5. **Teach** — walks the diff line by line, quizzes you
6. **Ship** — commits, branches, opens PR

## Install

```
git clone <this repo> ~/code/grillme-skill
cd ~/code/grillme-skill
./install.sh
```

Restart Claude Code. In any project: `/grillme`.

## Requires

- Claude Code
- `codex` CLI (`npm i -g @openai/codex`) for autorun. Optional — skill prints prompt if missing.

## Layout

```
skill/SKILL.md       — main skill file Claude Code loads
plans/               — helper docs for plan + grill + teach phases
builds/              — prompt templates fed to Codex
templates/           — GRILLME.md project memory template
install.sh           — symlinks skill into ~/.claude/skills/grillme
```

## Why not just mattpocock/skills?

That repo = Claude only. This one = Claude plans, Codex builds, you learn.
