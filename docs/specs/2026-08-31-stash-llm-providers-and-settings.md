# Stash: LLM provider choice + mature settings

Status: draft
Source: LLM features are Claude-only and invisible — no provider/model choice,
settings is a bare input box, testers without Claude subscriptions get no
chat/enrichment, and the app icon is a placeholder.

## Goal

One provider+model choice — made on first run (wizard step 2) or later via
tray Settings… — drives ALL LLM features instantly: Claude via the Agent SDK
(default provider, default model Haiku 4.5, curated model list) or local
Ollama via a built-in minimal tool loop (model list live from `/api/tags`).
Chat answers from the vault on both providers. Settings view matures: app
name/icon/version, Vault + AI sections, provider status lines, keyboard-first.
Icon pipeline: user drops a 1024×1024 PNG, build regenerates the icon set.

## Non-goals

- Third-party agent harness (pi etc.) — rejected: cannot carry Max OAuth,
  dependency cost exceeds the ~200-line DIY loop. Revisit only when 3+
  API-key providers matter.
- API-key Claude access (Agent SDK OAuth only), per-feature model mixing,
  embeddings/RAG index, separate settings window, themes, other providers
  (OpenRouter et al.).

## Riskiest assumption

Small local models' tool-calling is good enough for vault chat. T1 proves it
against a real Ollama before any app code; if tools flop, RAG-lite becomes
the primary Ollama path (T3 criteria already allow that pivot). Secondary:
Ollama may not be installed/running on the dev machine — T1 surfaces that as
a hold instead of burning build rounds.

## Tasks

### T1: Scout — Ollama tool-calling viability
- Type: scout
- Status: landed
- Checkers: report-checker PASS — all 4 questions answered, evidence reproduced; verdict: RAG-lite guaranteed path, tool loop gated on live probes (daemon up, zero models pulled; default suggestion qwen3:8b)
- Branch: —
- Escalation: none
- Acceptance criteria (questions the report must answer with evidence):
  - Is Ollama installed and reachable on this machine (`command -v ollama`; `curl -s localhost:11434/api/tags`)? Which version, which models are pulled? If not reachable: state exactly what the user must run (install/start/pull commands) and answer the remaining questions from the Ollama API documentation baked into the probe scripts, marked as unverified-live.
  - Does `/api/chat` tool calling work with an available local model? Evidence: a disposable probe script under `scripts/scratch/` (gitignored) that defines a `search_notes`-shaped tool, sends a question requiring it, and shows the model emitting a `tool_calls` response and consuming the tool result across ≥2 turns. Record which models succeed/fail.
  - Does streaming (`stream: true`) interleave sanely with tool calls (NDJSON chunks parseable, text deltas separable from tool-call deltas)? Show captured output.
  - Recommendation with reasoning: tool loop as primary with RAG-lite fallback, or RAG-lite as primary; and one suggested default local model.
  - Report at `docs/reports/stash-llm-providers-and-settings-t1.md`; no app code changed.

### T2: Provider seam + LLM config
- Type: ship
- Status: landed
- Checkers: behavioral PASS / audit PASS — flags: config-write race window (fix folded into T5), auth probe = 1 real model call each (T5 calls sparingly), unused chatDeps seam bypass (cleanup in T3). See docs/reports/stash-llm-providers-and-settings-t2-check.md
- Branch: anchor/stash-llm-providers-and-settings-t2
- Escalation: none
- Acceptance criteria:
  - `~/.config/stash/config.json` supports an `llm` object `{"provider": "claude"|"ollama", "model": "<id>"}` alongside `vaultDir`; absent → defaults `{provider: "claude", model: "claude-haiku-4-5"}`. A Tauri command reads it and a command writes it atomically (same atomic-write mechanism as `set_vault_dir`); changes apply to subsequent chat/enrichment calls without restart.
  - The sidecar resolves every LLM call through one provider seam: provider "claude" routes to the existing Agent SDK path with the configured model (`STASH_MODEL` env still wins as override, documented in code); provider "ollama" routes to an `ollama` module (stub acceptable in this task — it may throw a typed not-implemented error; T3/T4 fill it).
  - Status/probe commands exist and are callable from the frontend: one returning Claude auth status (reuse the existing auth detection), one returning Ollama reachability + the model list from `GET localhost:11434/api/tags` (typed "unreachable" result when down, no throw).
  - A curated Claude model list (at least `claude-haiku-4-5`, `claude-sonnet-5`, `claude-opus-5`) lives in ONE exported constant the settings UI consumes.
  - No new npm/cargo dependencies (Node 22 native fetch for Ollama HTTP). `npm run typecheck` (root), sidecar `npm run typecheck` + `npm test`, and `cargo test` in `src-tauri` all pass; new config parsing/defaulting logic is unit-tested in the sidecar or Rust.

### T3: Ollama chat with vault access
- Type: ship
- Status: landed
- Checkers: round 2 (post-freshness-rebuild) behavioral PASS / audit PASS — merge proven lossless, unified error pair verified at all consumers; round 1 PASS/PASS reopened for T4 conflict
<!-- 2026-08-31 reopened at land: freshness conflict with landed T4
     (provider.ts, provider.test.ts); rebuild against current main. Prior
     verification PASS/PASS predates the conflict. -->
- Checkers: behavioral PASS / audit PASS — flags: symlink vault-escape in read_note (pre-existing, shared with mcp.ts — follow-up task recommended); raw-body residue on unclassified errors; T4 test-file overlap. See docs/reports/stash-llm-providers-and-settings-t3-check.md
- Branch: anchor/stash-llm-providers-and-settings-t3
- Escalation: none
- Acceptance criteria:
  - Blocked by: T1 (follow its primary-path recommendation), T2.
  - With `llm.provider: "ollama"`, sending a chat message runs a bounded loop (≤8 turns) against `POST localhost:11434/api/chat` with the configured model: tools `search_notes` (query → matching note titles/snippets from the vault) and `read_note` (id/path → note body) are offered when the model supports tool calling; tool calls execute against the vault and results feed back until a final answer.
  - Fallback: if the model rejects tools or T1 recommended RAG-lite as primary, the message is answered single-shot with top vault search hits injected into the prompt; the mechanism chosen is logged once per turn.
  - Streaming text deltas reach the existing `chat-chunk` Tauri event so the chat view renders progressively, and the final answer replaces the stream exactly as the Claude path does; conversation continuity via transcript replay (full history resent each turn).
  - The loop is DIY: no new dependencies; HTTP via native fetch; the loop core (turn accumulation, tool-call dispatch, cap) is a pure function unit-tested in the sidecar with a stubbed HTTP layer (`npm test` in `sidecar/` passes with new tests).
  - Ollama down or model missing mid-chat → in-transcript message naming the problem ("Ollama not reachable at localhost:11434" / "model X not found — pull it or pick another in Settings"), never a raw error dump. `npm run typecheck` passes.

### T4: Ollama enrichment + unified degradation
- Type: ship
- Status: landed
- Checkers: behavioral PASS / audit PASS — flags: STASH_OLLAMA_URL undocumented + probe/traffic asymmetry (1-line fix suggested), cosmetic stale comment. See docs/reports/stash-llm-providers-and-settings-t4-check.md
- Branch: anchor/stash-llm-providers-and-settings-t4
- Escalation: none
- Acceptance criteria:
  - Blocked by: T2 (and T3's module layout).
  - With `llm.provider: "ollama"`, enrichment runs the same configured model single-shot (prompt → JSON, no tools); one retry on malformed JSON, then skip WITHOUT writing any marker frontmatter (a later run re-enriches) and one log line — mirroring the existing no-auth skip contract, unit-tested the same way (`sidecar/src/enrich.test.ts` pattern; sidecar `npm test` passes).
  - Ollama-unreachable and model-missing failures are typed like `NotAuthenticatedError` (stable message prefix) end to end: enrich worker logs one line per job, no retry-loop, notes stay byte-identical on failure.
  - With provider "claude" everything behaves exactly as on main (no-auth degradation intact — existing sidecar tests still pass unchanged).
  - `npm run typecheck` (root + sidecar) and `cargo test` in `src-tauri` pass.

### T5: First-run AI step + mature settings view
- Type: ship
- Status: landed
- Checkers: behavioral PASS / audit PASS — flags: none. Held from auto-land per think agreement: user visual pass gates the merge.
- Branch: anchor/stash-llm-providers-and-settings-t5
- Escalation: none
- Acceptance criteria:
  - Blocked by: T2.
  - First-run wizard becomes two steps: vault location (unchanged behaviour) → AI setup, preselected `Claude / claude-haiku-4-5` so pressing Enter twice on a fresh machine (no config, no legacy vault) lands in capture with defaults saved. The AI step offers provider Claude|Ollama; Claude shows the curated model list; Ollama shows live models from the T2 probe (or "Ollama not running" with the option still selectable-but-disabled).
  - Tray → Settings… opens the same view with both sections visible for later changes: header with app name "stash", icon, and version read from the build (Tauri app version API, not a hardcoded string); **Vault** section (current path, change flow as today); **AI** section (provider toggle, model dropdown per provider, live status line per provider: Claude authenticated-or-not, Ollama reachable-or-not).
  - Keyboard-first: Tab/arrows move between fields, Enter saves, Esc cancels (still swallowed on first run); mouse also works. Saving applies provider/model to the running app without restart (verified against the T2 command).
  - The settings/wizard state logic (step flow, field selection, what-to-save) is a DOM-free pure module in `src/lib/` with assert coverage via a `scripts/*-demo.ts` script that runs green under `npx tsx` (repo convention).
  - `npm run typecheck` passes; `cargo test` in `src-tauri` passes.

### T6: Icon pipeline
- Type: ship
- Status: landed
- Checkers: behavioral PASS / audit PASS — flags: none
- Branch: anchor/stash-llm-providers-and-settings-t6
- Escalation: none
- Acceptance criteria:
  - `scripts/regen-icons.sh` exists: takes `packaging/icon.png` (1024×1024 PNG; errors with a clear message if absent or wrong dimensions — check via `sips -g pixelWidth -g pixelHeight`), runs `npx tauri icon packaging/icon.png`, leaving the regenerated set in `src-tauri/icons/`.
  - `docs/release.md` gains an "App icon" note: requirements (1024×1024 PNG, content within ~80% of canvas for macOS inset), where to drop it, the one command to run.
  - `packaging/icon.png` itself is NOT committed by this task (the user supplies it later; script is idempotent whenever they do).
  - `bash -n scripts/regen-icons.sh` passes; `npm run typecheck` unaffected and passing.

### T7: Realpath-confine vault reads + probe URL unification
- Type: ship
- Status: todo
- Branch: —
- Escalation: none
- Acceptance criteria:
  - Added 2026-08-31 at land from T3/T4 audit flags (see docs/reports/stash-llm-providers-and-settings-t3-check.md and -t4-check.md).
  - `notePath`/vault-read confinement in BOTH `sidecar/src/vault.ts` and `sidecar/src/mcp.ts` resolves symlinks (`fs.realpath` on the candidate AND the vault root) before the containment check, so a symlink inside the vault can no longer read files outside it; a unit test in each module's test file creates a symlink escaping a scratch vault and asserts the read is rejected (skip gracefully on filesystems without symlink support).
  - `probeOllama` resolves its base URL through the same `ollamaBaseUrl()` helper as the prompt/chat paths (honoring `STASH_OLLAMA_URL`), so the settings status line and actual traffic can never diverge; existing probe tests updated accordingly.
  - `STASH_OLLAMA_URL` and `STASH_MODEL` overrides get a short "Environment overrides" note in `docs/release.md`.
  - Root + sidecar `npm run typecheck`, sidecar `npm test`, and `cargo test` in `src-tauri` all pass; no new dependencies.

## Holds
<!-- decision forks recorded by agents; user resolves at /anchor:land -->
