# Plan: GrillMe v3 — skill + Tauri companion app

## Goal
GrillMe is two things working together:
1. **Claude Code skill** (`/grillme`) — does the coaching loop (orient, grill, plan, hand off to Codex, teach, ship). Writes everything to disk.
2. **Tauri desktop app** (`GrillMe.app`) — watches those files and shows a live dashboard. Survives `/clear`. Always shows you what you're building, where you are, how much time is left, what you learned.

The skill is the brain. The app is the eyes.

## Architecture

```
+--------------------+      writes      +---------------+      reads      +-------------------+
|  Claude Code       | --------------> |  Project repo | <-------------- |  GrillMe.app      |
|  /grillme skill    |    GRILLME.md    |  (your code)  |     watches     |  (Tauri, Mac)    |
|  + Codex handoff   |    PLAN.md       |               |                 |  Live dashboard   |
|                    |    LEARNED.md    |               |                 |  Time + progress  |
+--------------------+    .grillme/     +---------------+                 +-------------------+
                         state.json
```

- Skill writes to `.grillme/state.json` on every phase transition
- App uses `notify` (Rust file watcher) to react in real time
- App reads markdown files, parses, renders dashboard
- No sockets, no IPC, no server. Just a watched directory.

## Steps

### Phase A — Skill core (smaller scope than v2)
1. **Single skill, args-based.** Keep one `skills/productivity/grillme/SKILL.md`. Add args: `--orient`, `--ship`, `--learn`, `--hackathon <hours>`, `--voice`. No multi-skill split.
2. **State file.** Skill writes `.grillme/state.json` at every phase change. **Atomic write pattern** (eng-review locked): write to `.grillme/state.json.tmp`, then `mv state.json.tmp state.json` (POSIX atomic rename). App never sees partial JSON. Schema includes `version: 1` field for forward compat.
   ```json
   {
     "version": 1,
     "project": "AI Resume Builder",
     "phase": "teach",
     "phase_num": 5,
     "started_at": "2026-06-14T10:00:00Z",
     "hackathon_hours": 4,
     "plan_file": "PLAN.md",
     "current_step": 6,
     "total_steps": 8,
     "last_codex_run": "2026-06-14T13:24:00Z"
   }
   ```
   App refuses unknown `version` values with a clear error: "GrillMe.app is older than this project's state schema. Update the app."
3. **LEARNED.md log.** `/grilllearn` (via `/grillme --learn`) appends learning entries with file+line refs.
4. **Hackathon mode.** Passive timer (computed from `started_at` + `hackathon_hours` when skill runs). Scope cap = 3 plan steps. Skip-grill option.
5. **Codex auto-pick.** `_shared/detect-task.sh` inspects PLAN.md keywords, emits codex flags.
6. **TTS voice (opt-in).** `--voice` pipes Phase 2 grill questions + Phase 5 teach via macOS `say`. You still type answers.
7. **Diagrams in teach phase.** Skill always renders ASCII diagrams when teaching anything with relationships, data flow, or state (even if user didn't ask).

### Phase B — Tauri app (new product)
8. **Scaffold.** `cd app && npm create tauri-app@latest grillme-app` — React + Tauri.
9. **File watcher.** Rust side uses `notify` crate to watch user's selected project dir for `.grillme/state.json`, `PLAN.md`, `LEARNED.md`, `GRILLME.md`. Emits Tauri events on change.
   - **Debounce 100ms.** macOS FSEvents fires 3-5 events per single file save. Without debounce, dashboard re-renders 5x per skill phase. Use `notify-debouncer-mini` crate.
   - **Watch parent dir for state.json creation.** App may open before `/grillme` runs. Watch project dir (not just `.grillme/`) so first state.json write triggers the dashboard.
   - **Schema version guard.** On state.json read, check `version` field. Unknown version → show error banner, do not crash.
10. **Dashboard UI.** Frontend (React) listens to events, re-renders.

    **Layout: sidebar nav + main pane** (Mac-native, like Mail.app):
    ```
    +-----------------+--------------------------------+
    | [Project name]  | [Main pane content]            |
    | [Phase x/6]     |                                |
    |                 |                                |
    | * Timer         |  switches based on             |
    |   Plan          |  sidebar selection             |
    |   Learn         |                                |
    |   Codex         |                                |
    |                 |                                |
    | [Switch project]|                                |
    +-----------------+--------------------------------+
    ```
    Sidebar ~200px wide. Current phase progress dot in sidebar header. Active item highlighted with accent color background.

    **Panes**:
    - **Header (always visible, in sidebar):** project name (truncates with ellipsis if > 22 chars), `Phase 5/6` with progress dot
    - **Timer pane** (default landing if hackathon mode on): big countdown (SF Pro Display 72pt). Three states:
      - `>1h remaining` — green accent
      - `1h to 30min` — amber accent
      - `<30min` — red accent
      - `<5min` — red + pulsing animation (subtle, 1s cycle, opacity 0.7→1.0)
      Below countdown: `Started: 2:14pm · Phase 5/6 · Step 6 of 8`
    - **Plan pane:** step list. Checkbox per step. Current step has accent left-border (2px) + bold. Done steps have strikethrough. Click any step to view its details (read-only — skill writes, app reads).
    - **Learn pane:** scrollable list of LEARNED.md entries, newest first. Each entry: bold concept name, dimmed date, code snippet with file:line ref styled as monospace block. ~12 entries visible at once.
    - **Codex pane:** last run timestamp, diff stat ("3 files changed, +47 -12"), last codex message excerpt (3 lines).

    **First-run state (no project picked yet):**
    Centered single column, max-width 420px:
    - GrillMe logo (medium size, 64x64)
    - H1: "Welcome to GrillMe"
    - One sentence: "Your live dashboard for vibe-coding sessions. Pick a project to begin."
    - Primary button (accent color): "Pick project folder" (opens Tauri folder dialog)
    - Below in dimmed text: "Tip: run `/grillme` in Claude Code on your project first — that creates the state file this dashboard reads."

    **Empty states per pane (project picked, no /grillme session active):**
    - Timer: "No active session. Run `/grillme --hackathon 4` in Claude Code to start."
    - Plan: "PLAN.md is empty. Tell Claude what you're building."
    - Learn: "Nothing learned yet. Quiz wins land here."
    - Codex: "No Codex runs yet."

    **Design tokens**:
    - Fonts: SF Pro Display (large display), SF Pro Text (body), SF Mono (code). All built into macOS, free. No custom font load needed.
    - Color: dark mode default (matches Mac coding aesthetic). Background `#0d1117`, surface `#161b22`, text `#e6edf3`, accent green `#3fb950`, accent amber `#d29922`, accent red `#f85149`. Light mode = invert with `#fafbfc` background.
    - Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 px. Use these only.
    - Border radius: 6px on everything (cards, buttons, inputs). No mixed radii.
    - Touch/click targets: minimum 32px tall (Mac convention, smaller than mobile 44px).
    - Shadows: none on body content. One subtle elevation on dropdown menus only.
    - Motion: 150ms ease-out on hover/click. 1s pulse on critical timer state. No decorative animation.

    **Responsive intent**: window minimum 720x480. Below that, sidebar collapses to icon-only (40px wide).

    **Accessibility**:
    - Keyboard nav: `Cmd+1..5` jumps to sidebar items. `Cmd+,` opens settings. Tab order: sidebar → main pane.
    - Screen reader: each pane has `aria-label`. Timer announces every 5 min via aria-live polite.
    - Contrast: dark mode body text on bg = 16:1 (well past WCAG AA 4.5:1).
11. **Project picker.** App opens with a "Pick project folder" dialog (Tauri file dialog API). Remembers recent projects in `~/Library/Application Support/GrillMe/recent.json`.
12. **Notifications.** When hackathon mode timer hits milestones (3h, 2h, 1h, 30min, 10min), Tauri sends a native Mac notification.
13. **Sync (optional, deferred to v3.1).** App-side button "sync to gist" calls a Rust helper that runs `gh gist edit` against `.grillme/`.
14. **Packaging.** `tauri build` produces a `.dmg`. Sign with self-cert for now (no Apple Developer account needed for personal use). Document install in README: "First launch: right-click GrillMe.app → Open → Open. Gatekeeper warning is normal for self-signed apps."
15. **Logging.** Rust side logs to `~/Library/Logs/GrillMe/grillme-YYYYMMDD.log` via `tracing` crate. Levels: INFO for file events, WARN for parse errors, ERROR for crashes. React side: console only (DevTools open via right-click → Inspect Element in Tauri).

### Phase C — Glue
16. **Skill writes state on every phase boundary** (Phase 1 → state.json, Phase 3 → updated, etc.). Uses atomic-write helper from step 2.
17. **App detects orphaned state.** If `state.json` is older than 24h, show "No active session." Solves: open the app on a project not currently in a /grillme session.

### Phase D — Tests (smoke-only per eng review)
18. **shellcheck** on every `.sh` file in `skills/productivity/grillme/`. Wire into pre-commit hook.
19. **cargo test** one happy-path test on Rust file watcher: write a fake state.json, assert event fires within 200ms.
20. **Manual UI smoke checklist** in `docs/SMOKE.md`: open app, pick project, run `/grillme --hackathon 4` in terminal, verify dashboard appears and timer ticks.

## Done when
- `/grillme --hackathon 4` writes `.grillme/state.json` with start time
- `GrillMe.app` opens, picks the project, shows the dashboard
- Updating GRILLME.md from terminal (via skill Phase 6) causes the dashboard to refresh within 1 second (file watcher)
- Timer counts down across `/clear` calls in Claude Code (because skill recomputes from state.json each invocation)
- Tauri produces a working `.dmg` you can install fresh

## Stack
- **Skill side:** markdown + bash. No new deps.
- **App side:**
  - Tauri 2.x (Rust core)
  - React + Vite (frontend)
  - `notify = "6"` (Rust file watcher)
  - `serde` + `serde_json` (state parsing)
  - `tauri-plugin-notification` (Mac notifications)
  - `tauri-plugin-dialog` (folder picker)

## NOT in scope
- Windows / Linux build (Mac only for v3)
- Cloud sync via gist (deferred — app reads/writes local files only)
- Public marketplace listing (deferred from v2)
- Multi-user, sharing, team mode
- Full STT voice (only TTS; mic stays out)

## Risk flags (raised in eng review pivot)
- **Learning curve:** you've never shipped Tauri. Rust compile errors will sting. Mitigate: keep Rust side dumb (just file watch + emit events). Logic stays in React.
- **Code signing:** unsigned Mac apps require right-click → Open the first time. Document it; don't pay $99/yr Apple cert until users exist.
- **State drift:** if skill writes and app writes simultaneously, who wins? Solve: app is read-only for v3. Only "sync to gist" button writes, and that's deferred to v3.1.

## Next reviews
- After CEO accepts: re-run `/plan-eng-review` on the app architecture (file watcher races, state schema, packaging)
- `/plan-design-review` on app UI (dashboard layout, timer states, hierarchy)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 2 | CLEAR | 13 proposals, 9 accepted, 4 deferred (v3 pivot) |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | SKIPPED | local codex CLI broken |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | CLEAR | 7 issues found, 0 critical gaps; 3 decisions locked (atomic write, schema version, smoke tests), 4 defaults baked in (debounce, parent-dir watch, gatekeeper doc, logging) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score 3/10 → 9/10, 3 decisions (sidebar layout, warm first-run, 3-step timer states), full design tokens baked in |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **UNRESOLVED:** 0
- **VERDICT:** CEO + ENG + DESIGN CLEARED for v3. Ready to build.

