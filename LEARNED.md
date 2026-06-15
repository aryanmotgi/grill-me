# LEARNED

Things the user nailed in /grillme quizzes. Newest first.

## debounce — 2026-06-15

_ref: `app/grillme-app/src-tauri/src/watcher.rs`_

Wait until events stop arriving, then fire once. 100ms = imperceptible to humans (<200ms threshold) but enough to catch macOS FSEvents bursts. Same value works for hackathon + long-term.

## css opacity multiplies down the tree — 2026-06-15

_ref: `app/grillme-app/src/styles.css:45`_

Parent opacity 0.5 + child opacity 0.55 = effective 0.275 on the child. Opacity stacks multiplicatively across descendants — never overrides. Use rgba() colors if you need a child to escape parent opacity.

