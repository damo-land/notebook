# Overlay Focus and Inline Actions

Status: done
Source: First real multi-display use found five defects — the panel opens on the wrong display, off-center, never becomes the key window (typing needs a mouse click first), has square corners, and `/` actions fire only at line start; task rows have no completion affordance.

## Goal

Alt+space puts an already-focused, rounded panel on the display where the mouse
cursor is — horizontally centered, about 30% from the top — and you type
immediately, zero clicks, every time. Typing `/` anywhere opens a small menu at
the caret (task mode: deadline / category / alert; plain capture: the mode
commands plus alert); filtering as you type, Enter applies and consumes the
`/query` text, and a non-matching `/word` stays literal text. Task rows carry a
visible, clickable done-circle; Space keeps working.

## Non-goals

Display-preference settings, hover-reveal chrome beyond the done-circle,
restoring the deleted hint footers, any LLM change, search/chat alterations.
The `getVaultDir`/`NOTEBOOK_VAULT_DIR` privacy gap remains a separate standing
follow-up — deliberately not folded in here.

## Riskiest assumption

That key-window focus is achievable within the NSPanel + Accessory-app
constraints. The panel not becoming key is likely the same mechanism behind the
known full-screen non-drawing issue (T1 of the previous spec). If making the
panel key requires activating the app — with visible side effects such as the
previous app's menu bar or focus appearance changing — that tradeoff must be
surfaced as a hold, not silently accepted.

**Verification honesty, learned the hard way**: a previous DOM-level focus probe
passed while real alt+space focus was broken — it tested the caret inside the
webview, never whether the window becomes key. Automated evidence for focus must
target the window level (e.g. Rust-side confirmation that the panel is
`NSApp.keyWindow` after a cold show, logged), and the final authority is the
user typing on a secondary display at land. Screenshots cannot show vibrancy;
the harness (`scripts/shoot.sh`) provides fixture-vault, panel-only PNGs.

**Process hygiene** (unchanged from the previous spec): the app is a dock-less
tray process; Vite pins port 1420. Any agent launching it must tear the whole
tree down and confirm the port free afterwards.

## Tasks

### T1: Show path — key focus, display targeting, position, rounded corners
- Type: ship
- Status: landed
- Branch: anchor/overlay-focus-and-inline-actions-t1
- Escalation: none
- Checkers: behavioral PASS / audit PASS — NonactivatingPanel confirmed live (styleMask=0x80), no activation call anywhere in the real show path, no hold needed; corner radius verified by alpha measurement (7px transparent diagonal = exactly 12pt @ 2x); position arithmetic reproduced (400,252 = centered, 28%); retina-quirk test confirmed non-tautological. Flags: overflow:clip on #root can clip the motion overshoot (near-imperceptible); ChosenDisplay can go stale on display disconnect; uncancelled 300ms timer threads (visibility-guarded); cursor-coordinate anomaly left the containment path unexercised live. Manual-only: real alt+space focus + real multi-display targeting — the land conditions. Detail: docs/reports/overlay-focus-and-inline-actions-t1-check.md
- Acceptance criteria:
  - **Key focus.** After a cold show (app freshly launched, another app frontmost, panel summoned via the real show path — not the screenshot hook), the panel is the key window: keyboard input reaches the focused input with no prior click. Automated half: Rust logs a check that the shown panel is the application's key window (e.g. comparing against `NSApp.keyWindow` or the panel's `isKeyWindow`) immediately after `show_and_make_key`, and that log line appears in a harness run's dev log. Honest half: state plainly in the report that window-level key status on a REAL alt+space can only be confirmed by the user at land — a previous in-page probe passed while the real path was broken.
  - **If key status requires app activation** (e.g. `NSApp.activate`) with visible side effects — the frontmost app's menu bar changing, its window losing focused appearance — implement the least-intrusive working variant and record a hold describing the side effect and any alternatives, rather than choosing silently.
  - **Display targeting.** The panel appears on the display containing the mouse cursor at the moment of summoning. Implemented in Rust in the show path; the monitor is chosen by cursor position, not `current_monitor`/`primary_monitor` defaults. Covered by a unit test of the pure selection logic (given cursor point + monitor rects, pick the right one), plus a documented manual step for the real multi-display behaviour (agents cannot move the physical cursor across displays).
  - **Position rule.** On every show, the panel is horizontally centered on the chosen display with its top edge at roughly 25–30% of that display's height, and the height clamp from the previous spec now derives from the CHOSEN display, not the primary. Repositioning happens on show, so dynamic-height changes from prior sessions cannot leave a stale anchor. Evidence: a harness run's dev log reporting the chosen monitor and computed origin, plus arithmetic in the report showing the origin matches the rule for that monitor's size.
  - **Rounded corners.** The panel renders with a corner radius of 10–14px, consistent between the vibrancy material and the web content (no square material behind rounded CSS or vice versa). Implemented via the vibrancy call's radius parameter and/or a matching CSS `border-radius` on the root container — whichever combination produces clean corners; say which. Evidence: a harness screenshot where the panel's corner pixels are visibly rounded (transparent/desktop-colored corner cut), plus the CSS/Rust values quoted.
  - `source "$HOME/.cargo/env" && cargo check` exits 0; `cargo test` passes all pre-existing suites plus the new monitor-selection test; `npm run typecheck` exits 0.
  - No `target/debug/notebook`/`vite`/`tauri dev`/`tsx` process survives any run; port 1420 free afterwards.

### T2: Inline slash menu + task done affordance
- Type: ship
- Status: landed
- Branch: anchor/overlay-focus-and-inline-actions-t2
- Escalation: none
- Checkers: behavioral PASS / audit PASS — exact-span removal proven incl. duplicate-text cases; typed-vs-pasted rule verified (keydown-only trigger); palette/mode-Esc/Enter blocks confirmed byte-identical to main; ring calls the same markDone as Space (single updateNote site); menu screenshot re-shot live by checker. Flags (minor): ring CSS hardcodes alpha values instead of tokens; shoot-hook synthetic keydowns confirmed debug-gated. Detail: docs/reports/overlay-focus-and-inline-actions-t2-check.md
- Acceptance criteria:
  - **Inline trigger.** Typing `/` at ANY caret position in the capture textarea opens the action menu — not only at line start. The old line-start restriction is removed. Typing continues to filter the menu (`/dea` narrows to deadline). Enter (or click) applies the selected action and REMOVES the `/query` text from the body; Esc closes the menu leaving the typed text as-is.
  - **No-match degrades to text.** A `/word` matching no action leaves the menu closed or empty and the text literal — `Buy robot /data` saved as a note contains exactly `Buy robot /data`. A URL pasted mid-line (`https://a.b/c/d`) must not open the menu. State the rule used (e.g. menu opens only when `/` is typed, not pasted, and closes once the query stops matching).
  - **Per-mode actions.** In task mode the menu offers deadline, category and alert (each opening its existing field editor); in plain capture it offers the mode commands (task, knowledge, search, chat) plus alert. The existing top-of-input command palette behaviour may be unified into this mechanism or kept — say which, but `/` at line start must still work exactly as before for muscle memory.
  - **Menu placement.** The menu renders adjacent to the caret or the input (visually attached, not floating in dead space); evidence via a harness screenshot with the menu open mid-line (use `SHOOT_TEXT`/`SHOOT_TYPE` to stage it).
  - **Done affordance.** Each row in the tasks view shows a visible circle (empty ring) at its left; clicking it marks the task done via the same code path Space uses (the clamped vault write). Space continues to work unchanged. The circle follows the existing design language: hairline ring at low alpha, no filled chrome; on the selected row it may brighten. Evidence: a harness screenshot of the tasks view showing the circles, plus the demo scripts still passing (`tasks-view-demo.ts` untouched or extended, not weakened).
  - **Keyboard behaviour otherwise unchanged**: arrow navigation, Enter, Tab filter cycling, Shift+Enter newline all as before; demo scripts all pass individually via `npx tsx`; any keydown-handler diff beyond the inline-menu trigger is a finding.
  - `npm run typecheck` exits 0; `cargo check` exits 0 (no Rust changes expected — any Rust diff is a finding).
  - No app process survives any run; port 1420 free afterwards.

## Holds
<!-- decision forks recorded by agents; user resolves at /anchor:land -->
