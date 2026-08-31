# T1 check — Rename notebook → stash

Branch: anchor/stash-installable-app-t1 (commits 00552d9 + repair 00fc149)
Round 1: behavioral PASS / audit FAIL — SPLIT (treated as FAIL). Repair spent.
Round 2 (fresh checkers, both lenses): behavioral PASS / audit PASS. VERIFIED.
Round 3 (2026-08-31, after freshness rebuild onto main with T2/T3/T4/T5/T9
landed; merge commit 3b08816): behavioral PASS / audit PASS — merge verified
lossless (zero files added/dropped vs main, dependency sets identical,
sidecar tests byte-identical and green, "NotebookEdit" preserved). New
informational notes: localStorage category key renamed without migration
(persisted filter resets once); sidecar mcp.ts legacy-fallback branch has no
dedicated test (criterion required only the Rust tests). MERGED to main.
Repair confirmed by round-2 audit: `"NotebookEdit"` restored in
chat-demo.ts WRITE_TOOLS with explanatory comment; no other SDK-name
collisions remain (`rg -i 'notebook' scripts sidecar/scripts` clean apart
from that disclosed exception). Task queues at /anchor:land on flags +
manifest tripwire (auto-land blocked).
Round-2 audit extras (informational): TS/sidecar legacy-fallback mirrors
(vault/index.ts, mcp.ts) have no test exercising the legacy branch (Rust
side does); localStorage category key and shoot fixture marker renamed
without legacy read — old persisted filter resets, fixture check fails safe.

## Failure reason (repair this)

- `sidecar/scripts/chat-demo.ts:270`: the blanket rename changed
  `"NotebookEdit"` → `"StashEdit"` inside `WRITE_TOOLS`. `NotebookEdit` is a
  real Claude Agent SDK write-capable tool name (see
  `sidecar/node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:897`),
  a coincidental string collision with the old app name — NOT an app
  identifier. The scoping assertion at chat-demo.ts:272-275
  (`WRITE_TOOLS.every((t) => !offered.includes(t))`) verifies no
  write-capable tool is offered to the chat session; with `"StashEdit"` that
  entry checks a nonexistent tool and is silently vacuous.
  Fix: restore the literal `"NotebookEdit"` (comment that it is an SDK tool
  name, not the old app name). `sidecar/scripts/` is outside criterion 1's
  rg paths, so restoring it cannot break the rename check.

## Flags (persist to land)

- Spec defect: criterion 1 (`rg -il 'notebook'` must return nothing) and
  criterion 4 (legacy `~/Notebook` fallback must exist) are jointly
  unsatisfiable without literal-string obfuscation. Branch resolves it with
  disclosed split literals (`concat!("Note", "book")` src-tauri/src/index.rs:287,
  `"Note" + "book"` src/lib/vault/index.ts:207-211) plus explanatory
  comments. Audit judged this honest, not gaming.
- Tripwire (informational): manifests/lockfiles touched for name fields only
  (package.json, sidecar/package.json, both package-locks, Cargo.toml,
  Cargo.lock) — dependency lists identical, verified by audit diff.
- Informational, not repaired: pre-rename persisted state is stranded
  (localStorage key `notebook.tasks-view.category` → `stash.…`,
  `.notebook-*` temp-file prefix); `scripts/shoot.sh` fixture-marker rename
  fails safe. Behavioral checker also noted the resolution unit test kept its
  pre-rename fn name (contents renamed/extended properly).
- Note on the behavioral checker's "T1 removes the T5 feature" finding: a
  diff artifact — it compared against current main (post-T5 merge) instead of
  the merge-base; T1 branched before T5 and simply lacks it. Freshness merge
  at land will surface real conflicts (index.rs, lib.rs, search-view.tsx,
  index-api.ts overlap).

## Evidence highlights

- rg criterion: exit 1, no matches. productName "stash",
  identifier land.damo.stash, window title "stash".
- STASH_VAULT_DIR (index.rs:300, mcp.ts:55), STASH_MODEL (llm.ts:143),
  ~/.config/stash/config.json shape intact.
- Resolution order env → config → legacy ~/Notebook (logged) → ~/Stash;
  unit test extended with legacy + legacy-must-not-shadow-config cases, ran
  green. cargo test 25 tests 0 failed; typecheck clean. Worktree clean.
