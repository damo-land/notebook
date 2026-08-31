# T4 check — Delete a note (⌘⌫ → Trash)

Branch: anchor/stash-installable-app-t4 (commits 212fd9e, 51190b7)
Verdicts: behavioral PASS / audit PASS. Task verified.

## Flags (block auto-land; task is also Escalation: required)

- Dependency manifest + lockfile touched: `src-tauri/Cargo.toml` adds
  `trash = "5"` (resolves to trash 5.2.6; transitive deps incl. chrono,
  objc2, objc2-foundation, urlencoding, a second windows 0.56.0 entry in
  Cargo.lock). This is the exact dependency the acceptance criteria call for
  ("e.g. the `trash` crate") and matches the task's recorded escalation —
  informational, awaiting user approval at /anchor:land.

## Evidence highlights

- `delete_note` (src-tauri/src/lib.rs:648-659): `trash::delete` (never
  `fs::remove_file`; the remove_file hits at lib.rs:745-755 are pre-existing
  temp-file cleanup, untouched) then `index::remove_note`
  (src-tauri/src/index.rs:174-183, transactional delete from notes/tags/
  notes_fts). Registered in invoke_handler (lib.rs:1193).
- ⌘⌫ chord `isDeleteChord` (src/lib/index-api.ts:47-56, metaKey-gated) wired
  in search-view.tsx:101-110, tasks-view.tsx:124-138+162-166 (optimistic row
  removal), note-editor.tsx:54-57 → App.tsx deleteEditing (358-373) →
  setEditing(null) returns to the underlying view.
- Bare Backspace: only the gated chord touches Backspace anywhere in src/.
- Tests: cargo test all suites green (26 tests incl. new
  remove_note_drops_all_index_rows_for_that_note_only, written red-first);
  npm run typecheck clean. Worktree clean; no out-of-scope changes.
