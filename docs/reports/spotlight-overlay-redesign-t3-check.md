# Check report: spotlight-overlay-redesign T3 — Shell behaviours

Date: 2026-08-30
Branch: anchor/spotlight-overlay-redesign-t3 (commits e9e7850, 94fddd6, 48d5d97)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (flags)

Note: the behavioral checker was killed once mid-run by a session limit; the harness teardown fired
correctly through its unexpected death (port free, no survivors — independently confirmed). Second
accidental proof of the teardown path this spec.

## What this task fixed, in terms of the user's original complaints

- **Auto-focus**: all five views now call `useFocusOnOverlayShown` on their own primary input,
  listening for the `overlay-shown` event T2 introduced. Every stale `window.addEventListener("focus")`
  is gone (grep-verified).
- **Esc**: fixed as a side effect of focus, exactly as diagnosed — and *observed* working, not
  inferred: a temporary keydown probe after a hide/show cycle captured the overlay dismissing.
- **Dismissal discards drafts** (deliberate reversal): all four dismissal paths — Esc, Ctrl+W,
  alt+space toggle, click-outside — converge on one Rust function (`hide_overlay_panel`) which emits
  `overlay-hidden`; one frontend effect clears state. The builder caught that `toggle_overlay`
  previously bypassed the shared hide and would have been the one path that skipped clearing.
  The clearing carries a comment opening "THIS IS DELIBERATE, NOT A BUG" with instructions to delete
  the effect rather than patch around it. Chat transcript is deliberately excluded with reasoning
  recorded (already-sent conversation, not unsaved input — and a T14 criterion).
- **Dynamic height**: `ResizeObserver` on the unified `<main>` → `resize_overlay`. First-ever
  execution of T2's monitor chain came back CORRECT on the 2x display: log shows
  `2880x1800 px @ 2x -> 1440x900 pt; max 540 pt` — physical pixels would have wrongly given 1080pt.

## Criterion verdicts — all PASS, both lenses

Behavioral reproduced the evidence itself rather than trusting the builder's:
- `vrfy-reopen.png`: proves focus AND clearing in one image — a 32-char seeded draft is GONE after a
  real hide/show cycle and "typed after reopen" landed at the DOM caret (nothing lands unless focus
  returned).
- Heights: 1 line → 96pt (content asked 81, T2's floor bit), 6 lines → 188pt, 40 lines → 540pt
  (requested 936 → clamped; 540 = 0.60 × 900). Monotonic then plateau; plateau is the clamp, pinned
  by the cargo test. The 2x scale independently corroborated by every capture being exactly 2x.
- Shrink: grew to 188pt, dismissed, next open logged `requested 79 -> applied 96` and measured 96pt.
- Jank: 30+ live alternating resizes, mean 1.40ms / max 4.00ms against a 16.7ms frame budget. No hold
  recorded — correctly, since nothing janky was observed. Final visual judgement remains human.
- Transition: `.overlay-motion` block (App.css lines 47–74), 120ms enter/leave. Deleting it removes
  all motion and the JS degrades to a no-op — but the 120ms `setTimeout` in `dismissOverlay` survives
  as an invisible delay. Also: the leave animation only plays on page-initiated dismissals; click-outside
  and alt+space hide instantly because Rust removes the window before the webview is told.
- Guard: both branches reproduced — foreign-file dir refused (exit 1, file intact), marker-carrying
  dir reclaimed. Marker `.notebook-shoot-fixture` written immediately after mkdir.
- typecheck 0, cargo check 0, cargo test all suites, six demo scripts individually green. Worktree
  clean, port free, no survivors.

## Audit rulings on the disclosed deviations

All four judged **load-bearing, not creep**:
1. Rust changes (`overlay-hidden`, toggle reroute, `shoot_input`) — unavoidable; no frontend signal
   exists for a native-driven hide. Shoot-only additions gated on `cfg!(debug_assertions)`, inert in
   release.
2. Unifying five `<main>` roots — required so the appear animation doesn't refire on internal view
   switches and the measurement ref is stable.
3. `html/body/#root` height:auto + hidden page scrollbar — structural precondition: a height:100%
   ancestor makes `offsetHeight` echo the window size, defeating shrink entirely.
4. Capture textarea rows 3→1 with auto-grow — directly implements "one line ≈ a single input row".

## Flags

1. Three behaviours are code-verified only, needing a human: actual click-outside dismissal (the
   harness suppresses resign-key to survive captures), live layered-Esc keypresses, and perceived
   resize smoothness/transition feel.
2. `src/lib/overlay.ts` (new, ~147 lines) not named in the fence or the builder's disclosure list —
   contents judged squarely in-scope plumbing (dismissOverlay + the three hooks all views consume).
3. The 120ms invisible-delay remnant if the motion CSS is ever deleted.
4. Carried forward for T4: `.tasks-list` has no max-height, so a long list drives the window to the
   540pt clamp and then scrolls with the page scrollbar hidden — no affordance that more rows exist.

## Manual checks outstanding (for the user)

1. alt+space → type → click another app → alt+space: input EMPTY.
2. Same with the hotkey toggle instead of a click.
3. alt+shift+space → Esc → alt+shift+space → arrow keys move the selection without clicking.
4. Layered Esc through palette / field menu / field editor / note editor: each closes its own layer
   only; top-level Esc dismisses.
5. Live typing smoothness and how the 120ms transition feels.
