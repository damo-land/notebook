# T3 check — Ollama chat with vault access

Branch: anchor/stash-llm-providers-and-settings-t3 (commits 4e45b60, ee9eb3d)
Verdicts: behavioral PASS / audit PASS. Flags below block auto-land.

## Flags

1. SECURITY (pre-existing, now duplicated): the vault-escape guard in
   `sidecar/src/vault.ts` (`notePath`/`normalizeSegments`, byte-identical
   copy of `mcp.ts`) is string/segment-based and does not resolve symlinks —
   the audit checker empirically read a file outside the vault through a
   symlink placed inside it. Mitigations: tools are read-only (model cannot
   create symlinks); vector requires a hostile symlink already in the vault.
   Affects BOTH vault.ts (Ollama chat tools) and mcp.ts (external MCP
   exposure) — predates this task. RECOMMENDATION: new follow-up ship task
   "realpath-confine vault reads" fixing both call sites + symlink tests.
   Related: indirect prompt injection (a malicious note steering the model's
   read_note argument) is only dangerous in combination with this hole.
2. Unclassified Ollama errors (outside the enumerated down/model-missing
   cases) surface as `(chat failed: Ollama error: <first 300 chars>)` —
   criterion satisfied as written; cosmetic residue.
3. Checker couldn't locate the T1 scout report — expected: it lives
   uncommitted on main (docs/reports/stash-llm-providers-and-settings-t1.md),
   not in the worktree. Implementation follows its verdict (tool loop first,
   RAG-lite on rejection, per-session model memory).
4. Known overlap with T4 (provider.test.ts, ollama.ts docs) — freshness
   merge between the two at land must keep both sides' tests.
5. Minor out-of-scope (sanctioned by brief): chatDeps seam-bypass export
   removed from chat.ts; chat-demo.ts declares its own local copy.

## Evidence highlights

- Cap = 8 model calls, proven unbypassable under infinite identical tool
  calls; tool errors feed back as results, never abort or extra turns.
- Fallback + per-session ragOnlyModels memory tested incl. cross-turn; two
  log lines only on the transition turn (announcement), one otherwise.
- Streaming rides the provider-agnostic emitChunk → chat-chunk → finishTurn
  path; history producer (completed turns only) and consumer both verified.
- Live against the real daemon: model-missing path returns the exact
  friendly message. 31/31 sidecar tests; typechecks + cargo clean; no
  manifest/lockfile touches; localhost-only network surface.
