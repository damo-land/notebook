# Spotlight Overlay Redesign

Status: done
Source: The capture overlay is visually heavy and unlike Spotlight — oversized fixed window with dead space, opaque background, input styled as a bordered card, small monospace type — and focus never returns on reopen, which also silently breaks Esc.

## Goal

The overlay feels like Spotlight: native macOS vibrancy over a transparent
window, content-sized height that grows with typing or results and caps near
60% of screen height, system font at a larger size, no input chrome, and a
short appear/dismiss transition that reads as materialising rather than
animating. Focus is always in the input on open. Esc and click-outside both
dismiss, and dismissal discards anything unsaved.

All five views (capture, tasks, search, chat, note editor) share the window and
all five get the treatment.

## Non-goals

Light mode or theming, configurable appearance settings, markdown preview
rendering, Windows/Linux equivalents, tray or icon redesign. Explicitly NOT
draft preservation across dismissal — today's behaviour keeps typed text when
the panel hides, and that is being deliberately reversed.

## Riskiest assumption

That live per-keystroke window resizing is smooth enough to keep. Each resize is
an IPC round-trip to Rust, on the most-used path in the app. **Recorded
fallback if it proves janky: capture grows live, list views take fixed heights.**
A task that discovers this should record a hold rather than silently redesign.

Second: vibrancy requires `"macOSPrivateApi": true`. Fine for personal use;
it would bar Mac App Store distribution.

## Verification approach — new for this spec

Every previous task in this project was verified without launching the app.
That cannot work here: "looks like Spotlight" is not code-traceable. Agents in
this spec **do** launch the app and capture real screenshots with macOS
`screencapture`, attaching them as evidence, with measurable assertions
underneath so a later change cannot silently regress the look.

**Process hygiene is mandatory.** The app is a resident tray process with no
dock icon and Vite binds port 1420. Any agent that launches it MUST kill the
whole process tree afterwards and confirm port 1420 is free — a leaked process
blocks every later run and is invisible in the dock.

## Tasks

### T1: Screenshot harness
- Type: ship
- Status: landed
- Branch: anchor/spotlight-overlay-redesign-t1
- Escalation: none
- Checkers: behavioral PASS / audit PASS — flags: teardown backstop `pkill`/preflight patterns use an absolute path but argv is relative, so both are dead code (process-group kill + port check are the only working mechanisms); harness fails repeatedly when a full-screen app is frontmost (8 consecutive failures / ~13 min observed); `editor` view never successfully captured; frontend half of the dev hook is not independently gated. Detail: docs/reports/spotlight-overlay-redesign-t1-check.md
- Acceptance criteria:
  - A committed script (e.g. `scripts/shoot.sh` or `scripts/shoot.ts`) launches the app, waits for it to be ready, shows the overlay, captures a PNG of the overlay window, and tears the app down.
  - It captures the overlay **window specifically**, not the whole screen — `screencapture -l <windowid>` with the window id resolved at runtime, or an equivalent that produces an image containing only the panel.
  - It accepts a view argument so later tasks can shoot any of: capture, tasks, search, chat, editor. Views not yet reachable by hotkey may be reached by a documented test hook; say which.
  - It writes to a gitignored output directory and prints the absolute path of each PNG it wrote.
  - **Teardown is guaranteed**: after a run — success, failure, or interrupt — no `target/debug/notebook`, `vite`, or `tauri dev` process from the run survives, and port 1420 is free. Prove it: run the script twice back to back and show the second run succeeds without a port collision, plus `lsof -nP -iTCP:1420 -sTCP:LISTEN` empty afterwards.
  - Running it produces a PNG of non-zero size whose pixel dimensions are reported in the run output.
  - `npm run typecheck` exits 0.

### T2: Native window shell — transparency, vibrancy, resize, dismissal
- Type: ship
- Status: landed
- Checkers: behavioral PASS / audit PASS — evidence criterion marked UNVERIFIABLE-as-written by audit (no `screencapture -l` shot can show through-content; backing-store capture of a compositor-blurred effect). Both lenses independently measured `rgb(124,124,124)` vs main's `rgb(30,30,30)`, alpha 255 everywhere. Flags: unguarded `rm -rf "$FIXTURE_VAULT"` in shoot.sh honours a user-set `SHOOT_VAULT_DIR`; `resize_overlay` has no caller and its monitor/`to_logical` chain has never run; `overlay-shown` never emitted in any observed run and nothing listens yet; undisclosed +36 lines in `src-tauri/tests/durable_writes.rs`; two `window-vibrancy` versions in the tree; `pkill` pattern would also kill a sibling checkout's debug build. Detail: docs/reports/spotlight-overlay-redesign-t2-check.md
- Branch: anchor/spotlight-overlay-redesign-t2
- Escalation: required — adds a Cargo dependency (`window-vibrancy`) and enables `macOSPrivateApi`, a private-API code path.
- Blocked by: T1 (its screenshots are this task's evidence).
- Acceptance criteria:
  - `src-tauri/tauri.conf.json` sets `"transparent": true` on the main window and `"macOSPrivateApi": true` at the app level.
  - `window-vibrancy` is added to `src-tauri/Cargo.toml` and applied to the main window at setup with an appropriate macOS material (HudWindow or similar); the call site names the material.
  - A Tauri command resizes the overlay window to a caller-supplied height, clamped to a documented maximum (~60% of the active screen's height) and a documented minimum. The clamp is enforced in Rust, not trusted from the frontend.
  - Clicking outside the overlay hides it: the NSPanel's resign-key (or equivalent) path invokes the same hide used by Esc. Verified by a documented manual step in the report, since it needs a real click.
  - When the panel is shown, the frontend is told: the app emits an event on show (or an equivalent mechanism) that the frontend can listen for in order to focus its input. Name the event.
  - `source "$HOME/.cargo/env" && cargo check` exits 0 and `cargo test` passes all pre-existing suites (`alert_scheduler`, `durable_writes`, `enrich_pending`, `index_rebuild`, `search_notes`).
  - `npm run typecheck` exits 0.
  - Evidence: a screenshot taken with the T1 harness showing the overlay with a non-opaque background — desktop or window content visibly showing through the panel material. State plainly if the material renders differently than expected.
  - **Harness fix carried over from T1's check.** `scripts/shoot.sh` currently matches the app process with an ABSOLUTE path (`pkill -f "$REPO_ROOT/src-tauri/target/debug/notebook"` in `stop_app`, and the same shape in the preflight `pgrep`), but the app's actual argv is the RELATIVE string `target/debug/notebook`, so both are dead code. Fix both so they match a running instance. Prove it: with the app running, show the pattern used by the script matching that process (e.g. `pgrep -f <pattern>` returning the pid), and show the preflight guard now refusing to start when an instance is already running.
  - **Fixture vault override.** `resolve_vault_dir` in `src-tauri/src/index.rs` gains a `NOTEBOOK_VAULT_DIR` environment override, taking precedence over the config file and the `~/Notebook` default; when the variable is unset, resolution is byte-for-byte the behaviour it has today. `scripts/shoot.sh` sets it to a fixture vault it creates, so screenshots never contain the user's real notes. Prove it: a screenshot of the tasks or editor view showing fixture content, and a documented check that with the variable unset the resolved path is unchanged.

### T3: Shell behaviours — focus, dismissal semantics, dynamic height, motion
- Type: ship
- Status: landed
- Branch: anchor/spotlight-overlay-redesign-t3
- Escalation: none
- Checkers: behavioral PASS / audit PASS — focus+clear proven in one screenshot (seeded draft gone, typed-after-reopen present); heights 96/188/540pt reproduced, monitor conversion arithmetically verified (2x display), shrink observed 188→96pt; rm -rf guard exercised both branches; Esc observed working via keydown probe. Flags: click-outside clearing + layered Esc + jank are code-verified/manual-only; 120ms setTimeout survives CSS deletion as invisible delay; new src/lib/overlay.ts undisclosed by name (contents in-scope); App.css root sizing + rows=1 judged load-bearing for the height criterion, not T4 creep. Detail: docs/reports/spotlight-overlay-redesign-t3-check.md
- Blocked by: T2 (consumes its resize command and show event).
- Acceptance criteria:
  - On every open — first and subsequent — keyboard focus is in the active view's primary input. Proven by opening the overlay, dismissing it, reopening it, and typing without clicking: the characters land in the input. Record this as a documented manual step plus a screenshot from the T1 harness showing a visible caret or typed text after a reopen.
  - Esc dismisses the overlay from the top-level state of any view, and clears unsaved input state so the next open starts empty. Explicitly: typing text, pressing Esc, then reopening shows an EMPTY input, not the previous text. (This deliberately reverses the previous behaviour, which preserved the draft.)
  - Click-outside dismissal clears state identically to Esc.
  - Esc's existing layered behaviour is preserved where a view has inner state to back out of (a command palette open, a field editor open, a note open in the editor): Esc first closes that inner state, and only dismisses the overlay from the top level.
  - The window height follows content: with one line of text the overlay is close to a single input row; adding lines grows it; removing them shrinks it; it never exceeds the clamp from T2. Evidence: screenshots at one line, several lines, and beyond the clamp, with pixel heights reported and increasing then plateauing.
  - The overlay appears and dismisses with a short transition (target ≤150ms) implemented in CSS. It must be removable by deleting a single rule or class — name it in the report.
  - **If live resizing proves visibly janky**, do NOT silently redesign: record a hold recommending the documented fallback (capture grows live, list views fixed height) and implement the fallback only if instructed.
  - `npm run typecheck` exits 0 and every pre-existing demo script still passes (`scripts/*-demo.ts` individually via `npx tsx`).
  - **Safety guard carried over from T2's check.** `seed_fixture_vault` in `scripts/shoot.sh` begins with an unguarded `rm -rf "$FIXTURE_VAULT"`, where `FIXTURE_VAULT="${SHOOT_VAULT_DIR:-$OUT_DIR/fixture-vault}"` — so a user who points `SHOOT_VAULT_DIR` at a real directory has it deleted with no confirmation. Add a guard so the script refuses to delete a directory it did not create (e.g. require a marker file it writes itself, or refuse any path outside the gitignored output dir unless an explicit opt-in variable is set). Prove it: pointing `SHOOT_VAULT_DIR` at a directory containing a file the script did not create causes it to refuse and exit non-zero, leaving that file intact.

### T4: Visual design — typography, chrome, all five views
- Type: ship
- Status: landed
- Branch: anchor/spotlight-overlay-redesign-t4
- Escalation: none
- Checkers: behavioral FAIL / audit FAIL — BOTH solely on the "documented manual pass" clause, both explicitly passing every other criterion (keydown handlers byte-identical to main; zero monospace; all chrome deleted from CSS and markup; screenshots live-reproduced). Orchestrator ruling: spec defect in evidence location (T2 precedent — the doc lives in the check report); live manual pass is the land condition, performable only by the user (no Accessibility grant). Flags: TS getVaultDir ignores NOTEBOOK_VAULT_DIR (real-vault writes from capture/editor/task-toggle under the harness — follow-up); classifier-warned methods verified residue-free. Detail: docs/reports/spotlight-overlay-redesign-t4-check.md
- Blocked by: T3 (shares `src/App.css` and `src/App.tsx`; running them in parallel would conflict).
- Acceptance criteria:
  - The capture input renders in the **system** font stack (no `ui-monospace`/`Menlo`/monospace on the capture input) at a size of at least 20px.
  - The capture input has no visible chrome of its own — no border, no background fill distinct from the panel, no inner rounded card. Text sits directly on the panel material.
  - The capture placeholder is short — at most three words plus optional ellipsis (e.g. "Note…"). The removed hints (markdown, Enter to save, `/` for commands) do not reappear elsewhere as persistent chrome.
  - `html`, `body` and the app root have transparent backgrounds so the native vibrancy from T2 is visible rather than covered by an opaque layer.
  - The other four views — tasks, search, chat, note editor — are restyled to the same language: system font, the same type scale, no nested card chrome, consistent padding and row treatment. Each is evidenced by a T1 screenshot.
  - Existing functional behaviour is unchanged: all keyboard interactions in every view still work as before (arrow navigation, Enter, Tab filter cycling, Space toggle). Confirmed by the pre-existing demo scripts passing plus a documented manual pass.
  - Evidence: five screenshots, one per view, attached with their paths, plus a before/after pair for capture.
  - `npm run typecheck` exits 0 and `cargo check` exits 0.

## Holds
<!-- decision forks recorded by agents; user resolves at /anchor:land -->
