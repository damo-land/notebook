# Check report: notebook-v1 T4 — Capture flow (plain note)

Date: 2026-08-28
Branch: anchor/notebook-v1-t4 (commits 60534c8, 2e99766, 2e8c9fb)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (semantic flag)

## Criterion verdicts

All 6 criteria PASS by both checkers:
- Single textarea, monospace, no WYSIWYG; Enter→save→clear→hide (write awaited before hide — latency criterion), Shift+Enter newline.
- Empty guard `text.trim() === "" → return` — audit proved with spy-fs: whitespace inputs produce zero fs calls.
- notePath clamp: normalizes `.`/`..` both sides, trailing-slash-qualified containment check (defeats `NotebookEvil` sibling-prefix trick). Both checkers independently attacked: `/tmp/x.md`, `../`, nested traversal, `/etc/passwd`, vaultDir-with-`..` — all rejected, in-vault paths (incl. listNotes output) still resolve. createNote ids slugified (no separators survive) — no bypass.
- typecheck 0, cargo check 0, demo script 0. Worktree clean, exactly 3 on-scope commits.

## Flags (block auto-land)

1. **Rust bridge unscoped**: `vault_read_file/vault_write_file/vault_readdir/vault_mkdir` accept bare String paths, zero validation at the Rust layer; capabilities grant unchanged (core:default). Any JS in the webview can `invoke("vault_write_file", {path: "/etc/whatever"})` bypassing the TS clamp. Acknowledged in lib.rs comment. Criterion asked only for the TS fix — satisfied — but the app-security boundary is TS-only. Recommendation: clamp paths inside the Rust commands too (vault dir + ~/.config/notebook) in a later task (natural fit: T13 MCP or T11 sidecar hardening pass); v1 threat model is own-code-only webview, so acceptable to defer.
2. `csp: null` in tauri.conf.json — pre-existing from scaffold, NOT introduced here; noted for later hardening.
3. Housekeeping: docs/reports/notebook-v1-t3-check.md exists only uncommitted on main (anchor state) — audit checker couldn't see it in git history; verified against criterion text instead. No action needed.

## Manual runtime verification outstanding

Live keypress flow (Enter/Shift+Enter/empty-Enter, focus-on-show, overlay hide) — one manual pass at next `npm run tauri dev`.
