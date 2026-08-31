# T2 check — Checkbox in wizard + settings

Branch: anchor/stash-autostart-t2 (commits 4f635b2, 6543e52)
Verdicts: behavioral PASS / audit PASS (audit round 1 aborted on a session
limit — no verdict; fresh audit checker completed). Flags block auto-land.

## Flags

1. Consent race (settings mode): checkbox `useState(true)` renders checked
   until the async `get_autostart` probe lands; probe failure only
   console.errors. Fast Enter or failed probe → `set_autostart(true)` saved
   for a user who never touched the box (`initialAutostart` null counts as
   changed in savePlan). Fix shape: seed settings-mode checkbox from null /
   disable it until the probe resolves, and treat null initial as
   "unchanged" in savePlan.
2. Wizard partial failure: ai-step now runs two sequential actions
   (set_llm_config then set_autostart); a plugin refusal after the llm write
   leaves the wizard stuck mid-step with the llm choice already persisted —
   failure mode new to this diff. Acceptable (retry Enter works; error line
   shows) or fold into the same fix.
3. Arrow-key cycling doesn't reach the checkbox — pre-existing vault-only
   arrow behavior; Tab reaches it both directions. Cosmetic.
4. Live no-restart round-trip covered by the documented #[ignore] manual
   smoke (criterion explicitly permits).

## Evidence highlights

- Wizard default-checked, Enter-Enter → [set_llm_config, set_autostart(true)];
  unchecked → explicit set_autostart(false); all demo-asserted. Settings
  seeded from live get_autostart in the probe-once guarded effect; save loop
  strictly sequential (for..of + await, autostart last); checkbox genuinely
  visible (CSS audited for hiding tricks — none). Demo diffed directly: no
  existing assertion weakened; five added. typecheck + cargo + demo green;
  sidecar untouched; worktree clean; no dependency/manifest changes.
