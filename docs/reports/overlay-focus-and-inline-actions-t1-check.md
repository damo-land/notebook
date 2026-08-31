# Check report: overlay-focus-and-inline-actions T1 — Show path

Date: 2026-08-30
Branch: anchor/overlay-focus-and-inline-actions-t1 (commits 6aa1a24, 76a533c, 9074484)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (informational flags; the
real focus and multi-display tests are the land conditions, performable only by the user)

## The mechanism — best-case outcome

**`NonactivatingPanel` style mask.** The builder proved it bash-first with a scratch AppKit probe
before wiring: an accessory app's panel with `canBecomeKey=true` alone stays not-key while another
app is active; adding the mask flips it to key with the frontmost app unchanged. No `NSApp.activate`
exists anywhere in the real show path (audit grepped the whole diff; the only `set_focus` is the
pre-existing screenshot-hook line, untouched). **No hold needed** — this is the same mechanism
Spotlight and Alfred use, and the frontmost app keeps its menu bar and focus appearance.

The behavioral checker confirmed the mask is live in the running process: the logged
`styleMask=0x80` is literally the NonactivatingPanel bit.

Cold-show wrinkle, handled: the first-ever show reads not-key at the instant of the check and
converges within 300ms (in the checker's own run it converged WITHOUT the retry firing); every
later show is key immediately. The retry is guarded on `is_visible()`, so Esc-within-300ms cannot
have focus yanked back — verified by both lenses.

## Placement — verified by arithmetic, not eyeballing

- Behavioral redid the origin math from its own run's log: cursor → monitor 1440×900@2x →
  origin (400.0, 252.0) = ((1440−640)/2, 900×0.28). Captured window bounds: exactly 400,252,640,96.
- The tao coordinate quirk is real and pinned: monitor rects scale by each monitor's OWN factor
  while the cursor scales by the PRIMARY's, so physical-space containment is ambiguous on a
  2.0/1.0/1.0 desk. The test asserts the same physical point sits inside BOTH physical rects before
  showing the point-space answer is unique — non-tautological, would fail if the conversion were
  removed.
- `placement.rs` is genuinely pure (zero AppKit imports); 10 new tests, 25 total green.
- The height clamp now derives from the chosen display (`ChosenDisplay` state, fallback
  chosen → current → primary), and repositioning runs unconditionally on every show — the stale
  anchor that made the panel drift low is gone.

## Corners — measured, not eyeballed

Rust `apply_vibrancy(..., Some(12.0))` + CSS `#root { border-radius: 12px; overflow: clip }`.
The behavioral checker measured the PNG's alpha channel: all four corners transparent for 7px along
the 45° diagonal, opaque at 8px. Theory for 12pt at 2x: 24px × (1−1/√2) ≈ 7.03px. Exact match.

## Flags (informational)

1. **`overflow: clip` on `#root` can clip the motion overshoot** — the enter/leave animations
   translate `<main>` by −8px/−4px, and `#root` previously had `overflow: visible`. The clipped
   region coincides with near-zero opacity, so likely imperceptible, but it is an untested
   behavioral change beyond the corner radius. Judge by eye; one-line fix (padding or clip on a
   deeper element) if visible.
2. **`ChosenDisplay` staleness**: captured once per show, not revalidated before a later resize —
   a display disconnect while the panel is visible would clamp against a stale rect. Narrow.
3. The 300ms recheck spawns an uncancelled thread per show; rapid re-shows stack timers. Each is
   visibility-guarded, so no observed hazard — just not a single cancelled timer.
4. **Evidence confounds, stated honestly**: the harness path activates via the hook's pre-existing
   `set_focus`, so harness `isKeyWindow=true` does not prove the non-activating mechanism end to
   end; and the checker's run logged an anomalous cursor coordinate (outside the only display), so
   the containment path ran via the nearest-rect fallback, never live containment. Both therefore
   rest on the scratch probe + unit tests + the user's land test.

## Land conditions — the user's 30-second test

1. **Real focus**: with another app frontmost, alt+space → type immediately. Characters must land
   with no click. Watch that the frontmost app's menu bar does NOT change (that's the
   non-activating property working).
2. **Real display targeting**: put the cursor on each display in turn, alt+space — the panel must
   appear on that display, centered, upper third. The log line
   `[overlay] cursor … -> monitor … -> origin …` says what it chose if anything looks wrong.
3. Corners: 12px rounding visible on the real material.
