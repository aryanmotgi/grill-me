# Changelog

## 0.3.0 — Phase A: skill v3

- Single `/grillme` skill now takes args: `--orient`, `--ship`, `--learn`, `--hackathon <hours>`, `--voice`.
- New `.grillme/state.json` written atomically at every phase boundary via `_shared/write-state.sh` (tmp + POSIX `mv`). Schema includes `"version": 1`.
- `LEARNED.md` append log via `_shared/append-learned.sh`. Phase 5 quiz wins call it; `--learn` runs it standalone.
- Hackathon mode (`--hackathon N`): caps PLAN.md to 3 steps, stamps `hackathon_hours` in state, prints `Xh Ym left` timer at every phase boundary via `_shared/timer.sh`.
- Codex auto-pick: `_shared/detect-task.sh` greps PLAN.md (scaffold/feature/bug) and emits `-c model_reasoning_effort="..."` for Phase 4.
- Opt-in TTS: `--voice` exports `GRILLME_VOICE=1`; `_shared/voice.sh` wraps macOS `say`. No-op on non-mac / when flag unset.
- Phase 5 teach: ASCII diagrams default-on whenever code has data flow, state transitions, relationships, or module boundaries.
- `install.sh` now chmods all `_shared/*.sh` helpers.
