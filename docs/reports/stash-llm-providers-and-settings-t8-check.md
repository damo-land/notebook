# T8 check — Symlink-safe vault listing

Branch: anchor/stash-llm-providers-and-settings-t8 (commit ddc3d50)
Verdicts: behavioral PASS / audit PASS. Flags below block auto-land.

## Flags

1. Third instance of the class (out of criteria scope): Rust
   `reindex` (src-tauri/src/index.rs ~122-140) filters with
   `Path::is_file()` (follows symlinks) + `read_to_string` — a symlinked
   .md pointing outside the vault gets indexed into notes/notes_fts,
   surfacing in the overlay's OWN search/list UI. Severity lower than the
   sidecar surfaces (local index shown only to the user; not exposed to the
   chat model or MCP clients). Candidate final task: skip symlinks in the
   Rust scan (symlink_metadata check) + unit test — closes the class
   everywhere.
2. Intentional, documented trade: legitimately symlinked notes no longer
   appear in sidecar listings/search (consistent with T7's read rejection;
   comment at vault.ts:131-136).

## Evidence highlights

- Shared `listNoteFilenames` (withFileTypes + isSymbolicLink, non-recursive)
  used by both modules; all three MCP tools route through it. Completeness
  grep: no other note-enumeration path in either sidecar module.
- Behavioral checker independently reproduced the leak scenario → zero hits;
  honest notes intact. Test diffs pure additions (57/0, 25/0). 44/44 tests,
  typechecks + cargo green, worktree clean, no dependency changes.
