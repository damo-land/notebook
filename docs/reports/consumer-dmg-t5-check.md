# T5 check detail — settings AI status + silent degradation

Spec: docs/specs/2026-09-01-consumer-dmg.md
Branch: anchor/consumer-dmg-t5 (commits 7ee78e4, 7da9767; src-tauri/src/lib.rs,
src/lib/settings-flow.ts, src/components/setup-view.tsx, src/App.css,
scripts/settings-flow-demo.ts)

## Verdicts

- Checker A (behavioral, fable): PASS — exact off copy verified via demo
  script; no toast/dialog paths anywhere (no dialog plugin exists); creds
  gating + hint line verified; cargo test green (incl. new
  claude_creds_file_probe); typecheck clean; worktree clean.
- Checker B (audit, sonnet): PASS — no out-of-scope changes, no
  escalation-path touches; keychain probe confirmed presence-only
  (`.status()`, stdout/stderr nulled — contents never read).

Both PASS → task verified. Flags below block auto-land; queued at
/anchor:land.

## Flags (audit)

1. **Wizard-default gap (the substantive one).** First-run wizard's
   `initialLlmChoice(null)` still hardcodes `provider: "claude"`
   (settings-flow.ts:69-72), and `wizardConfirm`/`canSaveLlm`/`llmSaveAction`
   ignore `claudeCreds` — a fresh-install Enter-Enter flow on a machine with
   no Claude Code credentials persists `set_llm_config{provider:"claude"}`.
   Gating is enforced only in the settings-mode dropdown's `disabled`
   attribute. Outside the criterion's literal text (selector "offers"), and
   T3's startup auto-detect (separate branch) writes the llm key before the
   wizard runs on genuinely-first launches — but both merging leaves the
   wizard path inconsistent. Worth a follow-up or criteria amendment.

2. **"One status row" reading.** The new single summary row renders at the
   head of settings, but the pre-existing `claude — …` / `ollama — …` inline
   detail lines remain below it (unchanged from main). Not new to this diff;
   confirm intent if full consolidation was wanted.

3. **Keychain probe** — `security find-generic-password -s
   "Claude Code-credentials"` exit-status only; expected per the task brief,
   presence-only by construction.
