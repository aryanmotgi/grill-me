# GrillMe.app

The Tauri Mac desktop companion for the `/grillme` Claude Code skill. Watches your project's
`.grillme/state.json`, `PLAN.md`, `LEARNED.md`, and `GRILLME.md` and renders a live dashboard.

## Develop

```bash
cd app/grillme-app
npm install
npm run tauri dev
```

Requires Rust (rustup) and Node 18+.

## Build a DMG

```bash
npm run tauri build
```

The bundle is self-signed (`signingIdentity: "-"` in `tauri.conf.json`). Apple Gatekeeper will
warn on first launch.

## Install (first launch on a fresh Mac)

1. Open the `.dmg` and drag `GrillMe.app` into Applications.
2. The first time you open it: **right-click `GrillMe.app` → Open → Open**.
3. macOS will remember the exception and let you double-click after that.

This is normal for self-signed apps. We are not paying for an Apple Developer cert until users exist.

## Logs

`~/Library/Logs/GrillMe/grillme.log.YYYY-MM-DD`

## Recent projects

`~/Library/Application Support/com.aryanmotgi.grillme/recent.json`
