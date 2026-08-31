# T1 check — Autostart plugin + commands

Branch: anchor/stash-autostart-t1 (commits 890b75d, 8fa06fe)
Verdicts: behavioral PASS / audit PASS. Queues at /anchor:land on the
recorded escalation (new Rust crate).

## Flags (informational)

- Lockfile delta itemized clean: 6 new packages (tauri-plugin-autostart
  2.5.1, auto-launch 0.5.0, dirs 4.0.0, dirs-sys 0.3.7, redox_users 0.4.6,
  winreg 0.10.1), all genuinely transitive; zero pre-existing version lines
  changed. Capability `autostart:default` = exactly enable/disable/is-enabled
  (compile-time-validated grant).
- Narrow divergence window: plugin call succeeds but the follow-up config
  write fails → login item real, config stale (no rollback). Informational —
  UI reads live `get_autostart`, so the checkbox stays truthful regardless.
  The dangerous direction (macOS refuses → nothing persisted) is correct by
  the plugin-first `?` ordering.
- `autostart_smoke` #[ignore] stub lives in llm_config.rs tests (cosmetic);
  manual smoke procedure documented in commit 8fa06fe body — deferred to the
  user's app run, as the criterion permits.

## Evidence highlights

- LaunchAgent init in builder; both commands in generate_handler; live
  is_enabled (fails loud); merge-writer persistence with round-trip test
  both directions; home-dir resolution consistent with sibling commands.
- cargo 11 passed/1 ignored/0 failed; typecheck clean; no npm/sidecar
  changes; worktree clean; 5-file diff, no out-of-scope changes.
