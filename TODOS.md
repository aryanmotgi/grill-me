# TODOS — grillme-skill (v3 Tauri + skill)

## Deferred — v3.1
- **Gist cloud sync** — app-side button "sync session to gist". Pulls/pushes `.grillme/`, GRILLME.md, LEARNED.md. Requires gh CLI auth flow. P2.

## Deferred — v3.2
- **Marketplace listing** — submit plugin to Claude Code marketplace. Needs CHANGELOG, screenshots, demo gif. P2. Blocked by 2 weeks dogfood post-v3.

## Deferred — later
- **Full STT voice (whisper-cpp mic capture)** — currently TTS-only. Add mic + transcription for full hands-free at hackathon. P3.
- **Windows + Linux Tauri builds** — `tauri build` cross-platform. Mac-only ships v3. P3.

## v3.x — UX upgrades

### P2 — "Review me" button on Learn cards (spaced repetition)
- **What:** each LEARNED.md card in Learn pane gets a "Review" button. Click → app re-asks the original quiz question. You answer in the app. Right → card stays + interval doubles. Wrong → drops to short interval.
- **Why:** turns LEARNED.md from a static log into an active learning tool. Compounds the value of every Phase 5 win.
- **Pros:** spaced repetition is proven for retention. Resume-receipt becomes resume-knowledge.
- **Cons:** requires storing the original question (not just the answer). Schema change: each LEARNED.md entry needs a `question` field. Probably new file `.grillme/quiz-state.jsonl` for review intervals.
- **Context:** flagged 2026-06-14 during v3 dogfood. User expected Learn pane to be quizzable; clarified current shape is log-only.
- **Effort:** M (human ~6h / CC ~30min)
- **Priority:** P2
- **Blocked by:** v3 stable + a few hackathons of real LEARNED.md data to test against

## Risks logged (track during build)
- Tauri version churn — pin in Cargo.toml
- State schema drift — version field in state.json from day 1
- Burnout mid-Tauri-build — skill side ships standalone first
