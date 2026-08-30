# Check report: notebook-v1 T3 — Vault library

Date: 2026-08-28
Branch: anchor/notebook-v1-t3 (commit bd80add)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (semantic flag)

## Criterion verdicts

All 7 criteria PASS by both checkers. Highlights:
- Append-only invariant verified independently by both: behavioral did Buffer-level byte comparison incl. tabs/unicode/no-trailing-newline; audit read the on-disk file directly.
- All three `kind` values empirically exercised; empty tags round-trip.
- Demo script assertions substantive (strictEqual/deepStrictEqual, no swallowed try/catch).
- Worktree clean; diff = exactly 3 new files; no manifest/lockfile/CI touches; zero new deps (hand-rolled frontmatter).

## Flags (block auto-land)

1. **Out-of-vault write via `notePath()`** (`src/lib/vault/index.ts`): any `idOrPath` containing `/` or ending `.md` is treated as a literal path, bypassing `vaultDir`. Audit checker empirically confirmed `updateNote` mutated a file in `/tmp` (prepended empty frontmatter + appended text). No criterion covers path handling — informational, but real: callers (T4+, MCP in T13) must never pass untrusted paths, or `notePath` should clamp to vaultDir.
2. `tsx` resolved from npx cache, not a declared dependency — clean machine needs network on first demo run. Informational.
3. (audit note) `scripts/vault-demo.ts` outside tsconfig include — its types unchecked by `npm run typecheck`; runs via tsx transpile-only. Disclosure, not failure.

## Recommendation

Land T3 as-is (criteria met), then fix flag 1 opportunistically in T4 or T5 (clamp `notePath` to vaultDir, or make path-mode explicit) — record as spec criterion amendment on the next task touching the vault lib.
