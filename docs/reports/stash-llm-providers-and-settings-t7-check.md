# T7 check — Realpath-confine vault reads + probe URL unification

Branch: anchor/stash-llm-providers-and-settings-t7 (commits dffd2ca, faea14b)
Verdicts: behavioral PASS / audit PASS. Flags below block auto-land.

## Flags

1. RESIDUAL GAP (adjacent surface, empirically reproduced by audit): the
   listing paths still follow symlinks — `listVaultNotes` (vault.ts:131-151
   and mcp.ts:84-99) does raw readdir+readFile with no confinement, so a
   symlinked .md inside the vault leaks outside-file content into
   `search_notes` snippets, and mcp's `list_recent` returns an outside
   file's first line unconditionally. read_note/readVaultNote (this task's
   literal criterion) are fixed and tested; the enumeration surface is not.
   RECOMMENDATION: one more small task — lstat each dir entry during
   listing, skip (or realpath-confine) symlinks in vault.ts + mcp.ts, with
   the same style of symlink tests.
2. TOCTOU, low severity: confinement validates then readFile re-resolves —
   a symlink swapped between the two awaits can slip through. Requires local
   write access to the vault mid-window; such an attacker reads the target
   directly anyway. Accept for a local single-user app; note kept for the
   record.
3. Clean under attack elsewhere: APFS case-insensitivity handled (realpath
   canonicalizes), sibling-prefix guard (`/a/b` vs `/a/bb`) correct, no
   import-time side effects from the new mcp→vault import, old private
   copies fully deleted (no dead refs).

## Evidence highlights

- Shared `confineNotePath` (vault.ts:114-129): string checks first, then
  realpath on root + deepest-existing-ancestor of candidate, sep-guarded
  containment. mcp.ts:168 awaits the same helper.
- Behavioral checker re-ran the exploit independently (file symlink, dir
  traversal, symlinked vault root): all rejected, honest reads intact.
- probeOllama default now flows through ollamaBaseUrl() (ollama.ts:565) —
  probe and traffic can no longer diverge; new env-override test green.
- docs/release.md "Environment overrides" verified truthful against code.
- 42/42 sidecar tests, typechecks + cargo green, no manifest/lockfile
  touches, worktree clean.
