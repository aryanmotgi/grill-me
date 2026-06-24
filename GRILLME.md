# GRILLME — GrillMe project memory

## What this is
A Claude Code skill + Tauri Mac app that watches my project files and shows me a live coding dashboard while I work with Claude.

## Who it's for
Me — vibe coder, juggling hackathons + projects, learning to be more technical.

## Done when
I type `/grillme` in any Claude Code project, dashboard updates live, and I end the session understanding the code Codex wrote.

## Stack
- Skill: bash + markdown (Claude Code plugin format)
- App: Tauri 2.x (Rust file watcher) + React + Vite (UI)
- Handoff: `.grillme/state.json` (schema v1, atomic write)
- Builder: Codex CLI

## Where I left off
2026-06-14: Phase A (skill v3) shipped on `feat/skill-v3` → PR #1. Phase B (Tauri app) shipped on `feat/tauri-app` → PR #2. Smoke test passed (with 2 bugs fixed: Sidebar fallback, Timer hook order).

Next concrete step: merge PR #1, then PR #2. Then dogfood on a real hackathon.

## Blocking
Don't know Rust. If Tauri breaks I'm stuck. Mitigation: Rust side intentionally dumb (file watcher only, ~100 LOC). All logic in React.

## Decisions log
- 2026-06-14 — Pivoted v2 → v3 to add Tauri companion app — solves "context lost on /clear" problem
- 2026-06-14 — Single skill + args (not 4 separate skills) — DRY
- 2026-06-14 — Schema `version: 1` field day 1 — forward compat
- 2026-06-14 — Atomic state.json write (`.tmp` + rename) — no torn reads
- 2026-06-14 — TTS-only voice (no STT) — small scope, real value
- 2026-06-14 — Tauri over Electron — smaller binary, user chose it after Rust risk explained
- 2026-06-14 — Sidebar + main pane layout (not grid) — Mac-native, focused

## Things I don't understand yet
- Rust borrow checker (need basic literacy if Tauri side breaks)
- Tauri 2.x permission system (`capabilities/default.json`)
- macOS Gatekeeper self-cert flow (untested)
