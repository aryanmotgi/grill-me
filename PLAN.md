# Plan: ship v3 → dogfood

## Goal
Land both PRs to main, install fresh skill from main, dogfood on one real hackathon project (DealGhost) before next weekend.

## Steps
1. **Merge PR #1** (`feat/skill-v3` → `main`). Skill side first because Tauri reads files the skill writes.
2. **Merge PR #2** (`feat/tauri-app` → `main`).
3. **Reinstall skill from main:** `cd ~/GrillMe && git checkout main && git pull && ./install.sh`.
4. **Build a real dmg once:** `cd app/grillme-app && npm run tauri build`. Verify the `.dmg` opens on Mac with right-click → Open.
5. **Dogfood on DealGhost:** open `~/DealGhost` in new Claude Code session, type `/grillme --hackathon 2`, run through full loop, write 3 LEARNED.md entries.
6. **Fix anything broken** found during dogfood. Open small follow-up PRs.

## Done when
- Both PRs merged
- GrillMe.app installed from a real dmg, opens on double-click
- One real DealGhost session produced `.grillme/state.json`, `PLAN.md`, `LEARNED.md` with 3+ entries
- No new bugs blocking further use

## Next session pickup
Update GRILLME.md "Where I left off" after dogfood with what broke + what to fix.

## Reference
v3 architecture + reviews → `docs/PLAN-v3.md`
CEO plan → `~/.gstack/projects/GrillMe/ceo-plans/2026-06-14-v3-tauri.md`
TODOS → `TODOS.md`
