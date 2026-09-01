# T3 check detail — silent first-run provider auto-detect

Spec: docs/specs/2026-09-01-consumer-dmg.md
Branch: anchor/consumer-dmg-t3 (single commit 97e5551; src-tauri/src/lib.rs +9,
src-tauri/src/llm_config.rs +180)

## Verdicts

- Checker A (behavioral, fable): PASS — all five criteria; cargo test 14/0
  green incl. both new detect tests; typecheck clean; worktree clean.
- Checker B (audit, sonnet): PASS — all five criteria; no out-of-scope
  changes; no escalation-path touches.

Both PASS → task verified. Flags below block auto-land; queued at
/anchor:land.

## Flags (audit checker; informational per contract, block auto-land)

1. **Malformed-config clobber hazard (the serious one).**
   `config_has_llm_key` treats unparseable config JSON as "no llm key"
   (llm_config.rs:150-156, `unwrap_or(false)`), so detection proceeds;
   `update_config_json` treats the same unparseable file as an empty map
   (llm_config.rs:124-128) and writes only `{"llm": {...}}` — silently
   discarding a user's existing `vaultDir`/`autostart` on a config file with
   a JSON typo. Newly reachable on every app start. Does not violate the
   acceptance criteria as written, but contradicts the module's own stated
   contract ("a typo must not brick chat", llm_config.rs:8-11).
   Possible fix: skip detection (treat as "has llm key") when the file exists
   but fails to parse.

2. **Ollama probe is raw TCP connect** to 127.0.0.1:11434 (1s timeout), not
   an HTTP request — criterion said "responding on http://localhost:11434".
   Justified in-code: no HTTP client crate in Cargo.toml and new deps are an
   escalation. Any TCP listener on that port reads as Ollama.

3. **$HOME source inconsistency** — `claude_credentials_present()` reads
   `std::env::var("HOME")` (llm_config.rs:168) while the rest of the call
   chain uses `app.path().home_dir()`. Same value in practice.

## Behavioral checker caveat

"App fully usable with provider none" verified at unit level (`llm_disabled`
gate) — no live app-launch exercise.
