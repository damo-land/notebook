# Check report: spotlight-overlay-redesign T2 — Native window shell

Date: 2026-08-30
Branch: anchor/spotlight-overlay-redesign-t2 (commits dac7c7a, ca13fd7, 69f16c8)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (Escalation: required)

## A defect in my own criterion, found by the build

The evidence criterion asked for a screenshot "showing desktop or window content visibly showing
through". **That is unsatisfiable by any `screencapture -l` shot**: it reads the window's backing
store, while the blur is synthesized by the window server during compositing. The audit lens
correctly refused to mark it PASS and recorded it UNVERIFIABLE-as-written instead; the behavioral
lens passed it on the disclosed basis. Neither failed the build for my spec error, which is right.

**Consequence for the rest of this spec: vibrancy and translucency can only be judged by a human
looking at the running app.** T4's screenshots will be equally unable to show it. A region or
full-screen capture is not an acceptable substitute — it would embed the user's real screen
content, and the builder deleted one such capture that had caught a video mid-playback.

## What the evidence does and does not establish

Both lenses measured the PNGs independently and agreed:

- Dominant colour `rgb(124,124,124)` across both views (565,025 of 821,760 px in capture).
- Main's body fill is `#1e1e1e` = `rgb(30,30,30)`, source-verified from `git show main:src/App.css`.
- Alpha is **255 on every pixel**; the background band is perfectly flat (stdev 0.18).
- The unchanged `#2a2a2a` input chrome is still present, isolating the change to the body.
- No `vibrancy (HudWindow) not applied` line in any of five dev logs across three runs.
- Captures came from the composited path, not the offscreen fallback.

So: the vibrancy layer loaded and is rendering. Whether it *looks* like Spotlight over a real
desktop is unproven and unprovable by this method.

## Criterion verdicts

All others PASS by both lenses.

- Transparency + `macOSPrivateApi` present; audit confirmed the private-API surface is confined to
  what vibrancy needs — no other private-API-gated window config was added.
- `NSVisualEffectMaterial::HudWindow` with `NSVisualEffectState::Active` — deliberately not the
  default `FollowsWindowActiveState`, since a material that flattens to grey when not key is the
  exact complaint this redesign exists to fix. Applied before `to_panel`.
- Clamp is genuinely defensive, not a pass-through: `max.max(MIN)` first so `f64::clamp` cannot
  panic when min > max, and non-finite input routes to the minimum because NaN has no ordering and
  would slip through a bare clamp. Test covers 0, −500, 100000, NaN, ±INFINITY, and max<min.
- Click-outside uses `WindowEvent::Focused(false)` → `hide_overlay_panel`, the *same function* Esc
  calls, not a parallel implementation. Both lenses judged the approach sound and confirmed the
  builder's reasoning: a `panel_event!` handler would replace tao's delegate wholesale and stop
  Tauri emitting window events at all.
- `overlay-shown` emitted by `show_overlay`, which both real show paths funnel through.
- cargo check 0, cargo test 15/15 across 6 binaries (13 pre-existing + 2 new), typecheck 0.
- Harness fix reproduced live by the behavioral lens: argv is exactly `target/debug/notebook`; the
  relative pattern matched pid 17207/20125 while the old absolute pattern matched nothing. Preflight
  guard proven *in isolation from the port check* by launching the binary without vite.
- Fixture vault reproduced: `tasks.png` shows only invented notes (espresso machine, Lisbon
  passport, `#fixture` tags). Unset/blank/whitespace resolve byte-identically to before.

## Live evidence that click-outside is genuinely wired

The behavioral lens found six `overlay resigned key (screenshot hook: not hiding)` lines in its own
run. The handler fires on real key-resignation — only the `panel.hide()` call is skipped under the
screenshot hook, and that is the identical call Esc makes. So the suppression does not mask a broken
resign-key path. Both lenses verified the suppression cannot reach a release build
(`shoot_view_env()` short-circuits on `!cfg!(debug_assertions)` at compile time).

## Flags

1. **Unguarded `rm -rf` on a user-overridable path.** `seed_fixture_vault` in `scripts/shoot.sh`
   begins `rm -rf "$FIXTURE_VAULT"`, where `FIXTURE_VAULT="${SHOOT_VAULT_DIR:-$OUT_DIR/fixture-vault}"`.
   The default is safe; pointing `SHOOT_VAULT_DIR` at a real directory deletes it with no
   confirmation. **Recommend a guard in T3.**
2. **`resize_overlay` has no caller anywhere in `src/`** — never invoked, and its monitor chain
   (`current_monitor` → `primary_monitor` → `to_logical`) has never executed. The user's displays are
   2.0/1.0/1.0 scale, so a conversion error would be invisible on two and 2× wrong on the built-in.
   T3 is its first real caller.
3. **`overlay-shown` never emitted in any observed run** (the harness path bypasses it by design) and
   no frontend listener exists yet. Code-verified only; T3 consumes it.
4. **Undisclosed touch**: `src-tauri/tests/durable_writes.rs` +36 lines, outside the fenced file list
   and not in the builder's disclosures. Purely additive tests for the clamp; no existing assertion
   altered. Low-risk but should have been declared.
5. `pkill -f 'target/debug/notebook'` is deliberately un-scoped and would also kill a debug build
   running from a sibling checkout.
6. Two `window-vibrancy` versions in the tree — 0.6.0 transitively via `tauri-runtime-wry`, 0.8.0
   explicit. Cargo namespaces by version; informational.
7. Disclosed out-of-scope edits, both judged minimal and justified: one declaration in `src/App.css`
   (`body { background: transparent }` — without it an opaque body paints over the material and the
   window looks identical to before) and `scripts/shoot-window.swift` (needed for the harness fix).

## T1 findings, resolved

- **T1's capture assertion was genuinely weak** — it validated "captured a window correctly", not
  "captured the right window", and passed a transparent 1000×1000 shot of a hidden helper. Confirmed
  real by audit, and **fixed in-scope here** via a `floatingOnly` layer filter.
- **No contradiction** with T1's compositing comment: T1 described the panel's own collection
  behaviour; T2 documents the broader app-wide fact that every window the process owns reports
  off-screen while a full-screen app is frontmost. Different scopes. Belongs to a follow-up on
  full-screen/Spaces behaviour.

## Manual verification required — the only way to judge this task's actual goal

Run `npm run tauri dev`, press **alt+space**. Look at whether the panel reads as translucent HUD
material with the desktop blurred behind it, rather than flat grey. Then click another window and
confirm it hides (log prints `overlay resigned key: hiding`). Typography, the input's card chrome
and fixed sizing are all still T4's — ignore them.
