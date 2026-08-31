# Stash: launch at login

Status: draft
Source: stash is a resident hotkey overlay but must be manually launched after
every login — a background utility that isn't there when summoned is broken.

## Goal

"Launch at login" checkbox in the first-run wizard (default checked — the
Enter-Enter default path enrolls autostart) and in tray Settings…, backed by
the official `tauri-plugin-autostart`; toggling immediately registers or
unregisters the macOS login item; the checkbox always reflects the plugin's
actual state.

## Non-goals

Windows/Linux autostart configuration; start-hidden vs show-on-login options
(the app already launches as tray+overlay); hand-rolled launchd plists.

## Riskiest assumption

`tauri-plugin-autostart` registers cleanly for an unsigned dev-built .app —
macOS login items can be finicky about unsigned bundles. Verified via the
plugin's `is_enabled` round-trip on this machine; real distribution builds are
signed anyway.

## Tasks

### T1: Autostart plugin + commands
- Type: ship
- Status: landed
- Checkers: behavioral PASS / audit PASS — flags: informational only (clean lockfile delta; narrow write-fail divergence, UI reads live state). See docs/reports/stash-autostart-t1-check.md
- Branch: anchor/stash-autostart-t1
- Escalation: required — adds the `tauri-plugin-autostart` Rust crate (and its JS guest binding only if needed — prefer Rust-only commands to avoid a second dependency).
- Acceptance criteria:
  - `tauri-plugin-autostart` is added to `src-tauri/Cargo.toml` and initialized in the Tauri builder (`src-tauri/src/lib.rs`) with `MacosLauncher::LaunchAgent` default; the required permission is granted in `src-tauri/capabilities/default.json`.
  - Two Tauri commands exist and are registered: `get_autostart` returning the plugin's live `is_enabled()` bool, and `set_autostart(enabled: bool)` calling the plugin's enable/disable AND persisting `{"autostart": <bool>}` into `~/.config/stash/config.json` via the existing merge-writer (`update_config_json` in `src-tauri/src/llm_config.rs` pattern — other keys must survive, covered by a unit test).
  - A Rust unit test covers the config merge (autostart key round-trips without clobbering `vaultDir`/`llm`); the live plugin call is exercised by a manual smoke documented in the commit message or a `#[ignore]`d test (login-item registration is machine-state — not run in CI-style checks).
  - `cargo test` in `src-tauri` passes; root `npm run typecheck` passes; no npm dependency changes (Rust crate only, plus its Cargo.lock entries).

### T2: Checkbox in wizard + settings
- Type: ship
- Status: checking
- Branch: anchor/stash-autostart-t2
- Escalation: none
- Acceptance criteria:
  - Blocked by: T1.
  - The first-run wizard's AI step gains a "Launch at login" checkbox, default CHECKED — completing the wizard with pure Enter presses calls `set_autostart(true)`; unchecking before confirm skips enablement (calls `set_autostart(false)` or simply doesn't enable — pick one, make the demo assert it).
  - Tray → Settings… shows the same checkbox; its initial state comes from `get_autostart` (live plugin state, not only the stored config); toggling + save round-trips through `set_autostart` and the change is visible in `get_autostart` immediately (no restart).
  - The keyboard flow still works: the checkbox is reachable via the existing field-cycling (Tab/arrows), toggles with Space/Enter-appropriate key, and the save ordering remains strictly sequential with the other config writes (no concurrent config-file writers).
  - `src/lib/settings-flow.ts` models the new field and `scripts/settings-flow-demo.ts` gains asserts for: default-checked wizard save payload includes autostart=true, unchecked path, settings-mode toggle payload; demo runs green via `npx tsx`.
  - Root `npm run typecheck` passes; `cargo test` in `src-tauri` passes; sidecar untouched (`git diff` shows no `sidecar/` changes).

## Holds
<!-- decision forks recorded by agents; user resolves at /anchor:land -->
