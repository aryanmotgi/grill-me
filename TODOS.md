# TODOS — grillme-skill (v3 Tauri + skill)

## Deferred — v3.1
- **Gist cloud sync** — app-side button "sync session to gist". Pulls/pushes `.grillme/`, GRILLME.md, LEARNED.md. Requires gh CLI auth flow. P2.

## Deferred — v3.2
- **Marketplace listing** — submit plugin to Claude Code marketplace. Needs CHANGELOG, screenshots, demo gif. P2. Blocked by 2 weeks dogfood post-v3.

## Deferred — later
- **Full STT voice (whisper-cpp mic capture)** — currently TTS-only. Add mic + transcription for full hands-free at hackathon. P3.
- **Windows + Linux Tauri builds** — `tauri build` cross-platform. Mac-only ships v3. P3.

## Risks logged (track during build)
- Tauri version churn — pin in Cargo.toml
- State schema drift — version field in state.json from day 1
- Burnout mid-Tauri-build — skill side ships standalone first
