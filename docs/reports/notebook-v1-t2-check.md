# Check report: notebook-v1 T2 — Resident overlay window + global hotkey

Date: 2026-08-28
Branch: anchor/notebook-v1-t2 (commits 06614ca, 0f1defa)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (tripwire + flags)

## Criterion verdicts

All 6 criteria PASS by both checkers:
- ActivationPolicy::Accessory + tray icon (with Quit menu) in lib.rs setup.
- tauri-nspanel panel conversion (`to_panel::<OverlayPanel>()`, `tauri_panel!` macro).
- `TOGGLE_OVERLAY_SHORTCUT = "alt+space"` — single named constant, registered via tauri-plugin-global-shortcut, toggle handler show/hide.
- Esc + Ctrl+W → `hide_overlay` command; `src/lib/keymap.ts`, bound at root in main.tsx.
- Window: center, 640 fixed (resizable false), decorations false, alwaysOnTop true, visible false at start.
- typecheck exit 0; cargo check exit 0 (also `--locked` and forced-recompile verified).

Worktree clean. Base ancestry verified (diff correctly isolated).

## Flags (block auto-land; tripwire also fires on Cargo.toml/Cargo.lock)

1. Dependency manifest + lockfile: Cargo.toml (+tauri-plugin-global-shortcut, +tauri-nspanel, +tray-icon feature), Cargo.lock +154 lines. Expected stack for this task.
2. **Git-sourced dep**: tauri-nspanel from github.com/ahkohd/tauri-nspanel, manifest tracks branch `v2.1` (no rev); pinned only by Cargo.lock at `c9ec2130`. Future `cargo update` could move it. Consider pinning `rev = "c9ec213..."` in manifest later.
3. Out-of-scope (cosmetic): App.tsx/App.css rewritten to placeholder overlay input UI, react.svg deleted. Serves T4's ground; no criterion covers it.
4. No capability changes, no hooks, no CI/env touches, no test tampering.

## Manual runtime verification outstanding

Headless check could not exercise: actual alt+space toggle, panel focus, tray icon rendering, Esc/Ctrl+W in running app. Verify at first `npm run tauri dev`.
