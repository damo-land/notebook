# Consumer-friendly DMG: self-contained app, optional AI

Status: done
Source: DMG installs today still assume a dev machine (node, npm-installed
sidecar at the repo path, rust toolchain) — consumers hit background errors and
get stuck on settings; app must work out of the box with AI as an optional
add-on.

## Goal

A signed DMG that works on a clean Mac with zero developer tooling:

- Launch, capture, vault, tasks, search, alerts all work with no AI configured.
- LLM provider selector gains `--` (AI off); off = no sidecar-dependent
  features, no background processes, no errors.
- First run auto-detects provider silently: claude creds → claude; else Ollama
  reachable → ollama; else none. Failed probes never surface errors.
- Claude option works only where Claude Code credentials already exist on the
  machine (no in-app OAuth); general public path is Ollama or off.
- Sidecar (runtime + JS + deps) ships inside the .app — no `npm install`, no
  system node, no repo checkout.

## Non-goals

- In-app Claude OAuth / guided `setup-token` flow (later idea).
- Windows/Linux, App Store, auto-update (homebrew cask + manual DMG stay the
  update path).
- Any change to vault format, note model, or enrichment behaviour.

## Riskiest assumption

The Claude Agent SDK keeps working when the sidecar is bundled inside the .app
without system node/npm — the SDK spawns its own bundled CLI runtime, and its
runtime requirements (node on PATH? executable path override?) are unverified.
T1 proves or kills this before any packaging code is written.

## Tasks

### T1: Scout — self-contained sidecar packaging approach
- Type: scout
- Status: landed
- Branch: —
- Escalation: none
- Checkers: report-checker PASS — all 5 questions answered, evidence reproduced
- Acceptance criteria (questions the report must answer, with evidence):
  - What does `@anthropic-ai/claude-agent-sdk` (version in
    `sidecar/package.json`) require at runtime: does it need `node` on PATH,
    does it spawn a bundled `cli.js`, and can the JS runtime it uses be pointed
    at an app-shipped binary (cite the SDK's code/docs in
    `sidecar/node_modules/@anthropic-ai/claude-agent-sdk`)?
  - Can `sidecar/src/main.ts` be bundled to a single JS file (e.g. esbuild) and
    run by a node binary shipped as a Tauri resource/externalBin — proven by a
    scratch script under `scripts/scratch/` that runs the bundle with
    `PATH` stripped of node/npm and cwd outside the repo, exercising: ping,
    ollama path (HTTP), and an Agent SDK call (or documented failure)?
  - Where must the bundle + runtime live in the .app, and how does the Rust
    side resolve that path in a packaged build vs `tauri dev` (name the exact
    Tauri v2 API)?
  - What is the size cost added to the DMG (measure the bundle + runtime)?
  - Recommendation: one approach for T4, with the fallback if the Agent SDK
    cannot run bundled (e.g. claude provider requires system Claude Code
    install, ollama-only otherwise).
  - Report written to `docs/reports/consumer-dmg-t1-packaging.md`.

### T2: Provider off switch (`--`)
- Type: ship
- Status: landed
- Branch: anchor/consumer-dmg-t2
- Escalation: none
- Checkers: behavioral PASS / audit PASS — flags: none
- Acceptance criteria:
  - `src-tauri/src/llm_config.rs`: provider `"none"` accepted and persisted;
    `LLM_PROVIDERS` includes it; unknown provider still falls back to default;
    `cargo test` (in `src-tauri/`) passes.
  - `sidecar/src/provider.ts` mirror accepts `"none"`; `npm --prefix sidecar
    test` and `npm --prefix sidecar run typecheck` pass.
  - Settings view (`src/components/setup-view.tsx` / `src/lib/settings-flow.ts`
    / `src/lib/llm-models.ts`): provider selector shows `--` alongside
    claude/ollama; selecting it writes `{"llm":{"provider":"none"}}` to the
    config JSON; model selector hidden/disabled for `--`.
  - With provider `none`: enrichment worker performs no LLM calls and chat view
    (`src/components/chat-view.tsx`) shows a disabled state naming settings —
    no request reaches the sidecar (verify via code path + a test on the
    gating function).
  - `npm run typecheck` passes.

### T3: Silent first-run provider auto-detect (claude > ollama > none)
- Type: ship
- Status: landed
- Branch: anchor/consumer-dmg-t3
- Escalation: none
- Checkers: behavioral PASS / audit PASS — flags: malformed-config
  clobber hazard (vaultDir/autostart loss), TCP-not-HTTP ollama probe,
  $HOME source inconsistency — detail in
  docs/reports/consumer-dmg-t3-check.md; flags block auto-land
- Blocked by: T2 (needs `"none"` value).
- Acceptance criteria:
  - Detection runs only when the config JSON has no `llm` key; an existing
    persisted provider (including `none`) is never overwritten.
  - Order: Claude Code credentials present on machine → `claude`; else Ollama
    responding on `http://localhost:11434` (short timeout) → `ollama`; else
    `none`. The chosen provider is written to the config JSON with its default
    model.
  - Every probe failure is silent: no UI error, no dialog, no error-level log;
    detection completing with `none` leaves the app fully usable.
  - Unit tests cover the three outcomes and the "config already has llm" no-op
    (mock the probes); `cargo test` in `src-tauri/` passes.
  - `npm run typecheck` passes.

### T4: Bundle sidecar into the .app
- Type: ship
- Status: landed
- Checkers: behavioral PASS / audit PASS — flags: informational only
  (checksum-verified node download, JIT entitlements, pre-authorized esbuild
  + staged binaries) — detail in docs/reports/consumer-dmg-t4-check.md;
  escalation required blocks auto-land
- Branch: anchor/consumer-dmg-t4
- Escalation: required — adds bundling dependency and ships a JS runtime
  binary inside the app; approach comes from T1's report.
- Blocked by: T1.
- Acceptance criteria:
  - Packaged build (`npm run tauri build`): resulting `.app` contains the
    sidecar bundle + runtime per T1's recommendation; no reference to
    `CARGO_MANIFEST_DIR` repo paths at runtime
    (`src-tauri/src/lib.rs` `sidecar_dir`/`spawn_sidecar` reworked).
  - `tauri dev` still uses the live `sidecar/` source (dev flow unchanged).
  - With `PATH` set to `/usr/bin:/bin` (no node/npm) and cwd outside the repo,
    the packaged app's sidecar responds to ping and serves the ollama code
    path; claude path per T1's verdict.
  - Sidecar spawn failure is non-fatal: app launches, capture works, failure
    recorded once (log/state), not repeated error popups.
  - `cargo test` in `src-tauri/` and `npm run typecheck` pass.

### T5: Settings AI status + silent degradation
- Type: ship
- Status: landed
- Branch: anchor/consumer-dmg-t5
- Escalation: none
- Checkers: behavioral PASS / audit PASS — flags: wizard Enter-Enter can
  persist claude without creds; old per-provider status lines retained
  beside new row; keychain presence probe (expected) — detail in
  docs/reports/consumer-dmg-t5-check.md; flags block auto-land
- Blocked by: T2.
- Acceptance criteria:
  - Settings view shows one AI status row: off → "AI off — pick Claude or
    Ollama to enable chat & enrichment"; claude/ollama → provider + model and
    whether the sidecar is up.
  - No background error toasts/dialogs from sidecar or provider failures
    anywhere in the app; failures appear only as the status row's state
    (grep-verifiable: error-surfacing paths route to status, not alerts).
  - Claude appears selectable only when Claude Code credentials are detected
    on the machine; otherwise the selector offers ollama and `--` with a hint
    line for Claude.
  - `npm run typecheck` passes.

### T6: Release pipeline ships the bundle
- Type: ship
- Status: landed
- Branch: anchor/consumer-dmg-t6
- Escalation: none
- Checkers: behavioral PASS / audit PASS — flags: package.json postinstall +
  lockfile hasInstallScript (tripwire paths; hook verified verbatim), signing
  rework judged a strengthening — detail in
  docs/reports/consumer-dmg-t6-check.md; tripwire blocks auto-land
- Blocked by: T4.
- Acceptance criteria:
  - `scripts/release.sh --dry-run` reflects the new bundle steps;
    `npm run tauri build` from a clean checkout (after `npm install` at repo
    root only — no manual sidecar step) produces a DMG containing the sidecar
    bundle + runtime (verify by listing the mounted .app contents).
  - `packaging/homebrew/stash.rb` needs no consumer-side dependencies (no
    node/ollama requirement stanzas).
  - `docs/release.md` updated: clean-machine acceptance checklist (fresh macOS
    account: install DMG → capture works, no errors; with Ollama running →
    detected; `--` disables AI) recorded as the manual release gate.

### T7: Flag fixes — config-clobber guard + wizard creds gating
- Type: ship
- Status: landed
- Checkers: behavioral PASS / audit PASS — flags: none
- Branch: anchor/consumer-dmg-t7
- Escalation: none
- Source: checker flags from T3 and T5 (docs/reports/consumer-dmg-t3-check.md
  flag 1, docs/reports/consumer-dmg-t5-check.md flag 1), accepted at land on
  2026-09-01.
- Acceptance criteria:
  - When the config JSON file exists but fails to parse, first-run provider
    detection is a no-op: `detect_provider_on_first_run` /
    `detect_and_persist_provider` (`src-tauri/src/llm_config.rs`) neither
    probes nor writes — a unit test writes malformed JSON (e.g. `{"vaultDir":`)
    to the config path, runs detection with panicking probe closures, and
    asserts the file bytes are unchanged.
  - First-run wizard cannot persist `provider: "claude"` when Claude Code
    credentials are absent: the wizard's initial choice and save path in
    `src/lib/settings-flow.ts` (`initialLlmChoice` / `wizardConfirm` /
    `llmSaveAction`) take the creds signal into account, falling back to the
    detected/persisted provider (never claude without creds);
    `scripts/settings-flow-demo.ts` gains assertions for wizard flow with
    creds absent (claude not persisted) and present (unchanged behaviour),
    and `npx tsx scripts/settings-flow-demo.ts` passes.
  - `cargo test` in `src-tauri/` passes; `npm run typecheck` passes.

## Holds

- [ ] (none yet)
