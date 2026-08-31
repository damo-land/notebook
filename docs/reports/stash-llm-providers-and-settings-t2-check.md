# T2 check — Provider seam + LLM config

Branch: anchor/stash-llm-providers-and-settings-t2 (commits b4f1875, ec740d1)
Verdicts: behavioral PASS / audit PASS. All criteria met; flags below block
auto-land (queues at /anchor:land).

## Flags

1. Config-write concurrency: `update_config_json` is read→merge→atomic_write
   with no lock/CAS (llm_config.rs:106-124). Two writers now exist
   (set_vault_dir, set_llm_config); near-simultaneous invocation can silently
   drop the other's key (last rename wins). Sequential calls safe. The
   codebase already has a CAS pattern (`atomic_write(..., Some(seen))` in
   alerts.rs:142). RESOLUTION PLAN: T5 settings save must either serialize
   its writes (one command call at a time, awaited) or T5 adds the CAS/lock —
   note carried into T5's brief.
2. Claude auth probe (`claude_auth_status`) spends one real billable model
   call per invocation, no cache/debounce (main.ts:131-134, 60s timeout).
   Zero live callers today. T5 must call it once per settings-view open, not
   on mount-loops/intervals — carried into T5's brief.
3. `sidecar/src/chat.ts:118` still exports unused `chatDeps` bound to the
   unconfigured `runPrompt` — a seam bypass if a future caller grabs it.
   Candidate cleanup in T3 (which rewires chat anyway).
4. Informational: probeOllama's baseUrl param exists only for tests; all
   production calls hit http://localhost:11434 with zero args. No other
   hosts. No manifest/lockfile/CI touches; no dependency changes.

## Evidence highlights

- Fresh config read per chat turn (lib.rs:1273) and per enrich job
  (lib.rs:1356) — no cached LLM state; settings apply without restart.
- Single seam provider.ts; precedence explicit > STASH_MODEL > config >
  claude-haiku-4-5 (blank = unset), unit-tested; ollama stub typed with
  stable prefix; probe never throws (closed-port + malformed-body tests).
- set_vault_dir refactored onto the same merge-writer (was silently clobber-
  prone for future keys) — required by criterion 1, unit-tested.
- CLAUDE_MODELS sole constant (src/lib/llm-models.ts:10-14).
- Tests: root+sidecar typecheck clean, sidecar 18/18, cargo 9+24 green,
  worktree clean, no out-of-scope changes.
