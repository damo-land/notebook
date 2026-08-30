# Check report: spotlight-overlay-redesign T1 — Screenshot harness

Date: 2026-08-30
Branch: anchor/spotlight-overlay-redesign-t1 (commits 025cd24, f878868, 220eba7)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (flags)

## What it does

`scripts/shoot.sh` + `scripts/shoot-window.swift`. Launches the app with
`NOTEBOOK_SHOOT_VIEW=<view>`, the frontend reads it via a `shoot_view` command, switches to that
view, and only then calls `shoot_show_overlay` — showing last makes "panel is on screen" a true
readiness signal rather than a guessed delay. No keystroke injection anywhere (Accessibility is
not granted and will not be). Window id comes from `CGWindowListCopyWindowInfo` matched on owner
PID, excluding layer ≥20 — the app's own tray icon is a window and was an early false positive
that produced a 34×24 menu-bar screenshot.

Captures are 1280×642 px (640×321 pt at 2× scale) against a 2880×1800 screen — panel only,
visually confirmed on multiple PNGs.

## Criterion verdicts

All seven PASS by both lenses, executed ~8 times end to end.

- Back-to-back runs: run 1 (`capture tasks`), run 2 (`search chat`) — exit 0, no port collision,
  port free afterwards.
- **SIGTERM** to the script: exit 130, no survivors, port free, and it did **not** continue to the
  next view — zero PNGs written.
- **SIGINT** in the foreground: same. Worth recording how this was established: the checker's first
  SIGINT attempt appeared to show a resume, then it correctly identified that as its own test
  artifact (bash sets SIGINT to `SIG_IGN` for backgrounded scripts, so the trap never registered)
  and retested in the foreground. The builder's separate-traps fix is genuinely effective.
- Failure path: a 3×180s timeout run exited 1 with no survivors and port free.
- Release gate confirmed safe by both lenses: `shoot_view_env()` short-circuits on
  `!cfg!(debug_assertions)` **before** reading the env var, and `Cargo.toml` has no
  `[profile.release] debug-assertions` override. A release build cannot take that path.
- typecheck 0, cargo check 0, cargo test 13/13 across all five pre-existing suites.
- Worktree clean; diff is 5 files; no manifest, lockfile, CI, capabilities or config touched.

**Teardown was also proven by accident**: when the behavioral checker was killed mid-run by a
session limit, the orchestrator independently found port 1420 free, no surviving processes, and a
clean worktree. The trap fired correctly even though its caller died unexpectedly.

## Flags

1. **Teardown backstop is dead code — one-line fix.** `stop_app` runs
   `pkill -f "$REPO_ROOT/src-tauri/target/debug/notebook"` and preflight runs `pgrep -f` with the
   same absolute path, but the app's argv is the **relative** string `target/debug/notebook`.
   Demonstrated live: the absolute pattern matched nothing while the relative one matched. So both
   the belt-and-braces kill and the "already running" preflight guard can never fire. Only the
   process-group kill and the port-clear wait are load-bearing — those worked in every test, which
   is why the criterion still passes. **Recommend fixing before the harness is relied on by three
   more tasks**, since this is exactly the safety net for the leaked-instance failure the user has
   already hit once.
2. **One unattributed leak.** After a clean run 1, a `target/debug/notebook` (pid 37029, ppid 1)
   and its sidecar survived with port 1420 free. Its executable and cwd were the **main repo**, not
   the worktree — so not attributable to this harness, and it never recurred across ~8 later runs.
   Per flag 1, the harness would neither have killed nor detected it.
3. **Environment-dependent reliability — the practical risk for T2/T3/T4.** With a full-screen app
   frontmost, the harness failed 8 consecutive launch attempts over ~13 minutes: the dev log showed
   the panel being presented while `CGWindowListCopyWindowInfo(.optionOnScreenOnly)` never reported
   it. Not a permission problem — preflight reported `granted` throughout and a full-screen capture
   worked. Default cost of a failed run is 3×180s = 9 minutes. **Practical mitigation for later
   tasks: don't leave a full-screen app frontmost while a screenshot task is running.**
4. `editor` view never successfully captured — every attempt landed inside the flag-3 window. Its
   distinct frontend path (`listNotes`/`readNote`, which hard-fails on an empty vault) is
   unexercised.
5. Invalid-view rejection (`exit 2`) is present but was never executed.
6. Frontend half of the dev hook is not independently gated — `App.tsx` invokes `shoot_view` on
   every mount with no `import.meta.env.DEV` check, relying entirely on the Rust gate returning
   null. Sound as shipped (Tauri bundles both halves), but the two could drift.
7. `SHOOT_ALLOW_NO_CAPTURE` is a shell-only escape hatch no criterion asked for. Harmless — never
   exported to the app — and the builder disclosed it as expired in purpose.
8. The hook mutates the panel's `NSWindowCollectionBehavior` at runtime (join-all-Spaces,
   fullscreen-auxiliary). Confined to the debug+env-gated path.

## Privacy note

`tasks.png`, `search.png` and `editor.png` contain the user's **real notes** from the live vault —
`editor.png` shows an actual task. Nothing is committed (`screenshots/` is gitignored, verified via
`git check-ignore`, and no committed file references it), but these images become evidence in three
later tasks' reports. `resolve_vault_dir` has no override; adding a `NOTEBOOK_VAULT_DIR` fixture
path would contain this. **Open question for the user.**

## Real finding about the app itself (not this task)

The panel does not reliably draw while another app holds the foreground — confirmed with a region
capture showing the user's browser where the panel should have been. This is shipped behaviour,
independent of the dev hook. For an overlay meant to feel like Spotlight — which appears over
anything, including full-screen apps — this is arguably a genuine defect worth its own task.
