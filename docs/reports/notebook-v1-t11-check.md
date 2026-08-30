# Check report: notebook-v1 T11 — Agent sidecar (Claude Agent SDK + auth)

Date: 2026-08-28
Branch: anchor/notebook-v1-t11 (commits a816852, 12deaf3, bc8fdb0; rebuild merge fe0f733)
Verdict (round 2, post T5-conflict rebuild): behavioral PASS / audit PASS — verified, queued at /anchor:land (Escalation: required)

## Round 2 additions

- lib.rs merge union verified line-for-line vs both parents: all 11 commands present exactly once, T11's .build().run(RunEvent::Exit) structure intact, no conflict markers, cargo check + index_rebuild test + vault-demo all green post-merge.
- Smoke re-run both paths: authed "pong" exit 0; unauthed exit 1 with setup-token message.

## Criterion verdicts

All 5 criteria PASS by both checkers:
- Spawn on setup / kill on RunEvent::Exit (tray Quit → app.exit(0) confirmed as the real quit path); stdio line-JSON protocol documented in sidecar/README.md; standalone ping round-trip executed green.
- SDK ^0.3.250; repo-wide grep: ANTHROPIC_API_KEY appears ONLY at strip/ignore/doc sites (llm.ts delete, lib.rs env_remove, README, spec text). OAuth/subscription only.
- Single SDK import site (llm.ts) — repo-wide grep confirmed.
- Smoke both paths executed by behavioral checker: authed → "sidecar smoke OK. Model replied: pong" exit 0; unauthed (empty CLAUDE_CONFIG_DIR) → "Not authenticated. Run: claude setup-token" exit 1.
- Root + sidecar typecheck both 0. Worktree clean.

## Builder finding worth keeping

SDK 0.3.250 quirk: unauthenticated query yields `subtype:'success'` with `is_error:true` (not an error subtype). llm.ts checks is_error + AUTH_ERROR_PATTERN; brittle across SDK upgrades — re-verify on bump.

## Flags

1. **`Command::new("node")` resolves via PATH** — dev-only wiring (documented in README): bundled .app from Finder (minimal PATH) would silently lose agent features; writable earlier-PATH dir named `node` = hijack surface. Fix in bundling task (absolute path / sidecar binary), pre-v1-distribution.
2. sidecar/package-lock.json audited: 143 packages, all registry.npmjs.org, zero pre/post/install hooks, no typosquats.
3. Beyond criteria (benign): `sidecar_ping` command (fixed payload), `NOTEBOOK_MODEL` env override, unused `npm start` script.

## Why it waits

Escalation: required — user's Claude Max OAuth credentials; user should confirm smoke on their own terms at land (checkers already ran it green on this machine's login).

## Manual runtime verification outstanding

In-app spawn/kill lifecycle + `sidecar_ping` from the running app — first `npm run tauri dev`.
