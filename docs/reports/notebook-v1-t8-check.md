# Check report: notebook-v1 T8 — Tasks view

Date: 2026-08-28
Branch: anchor/notebook-v1-t8 (commits a966cdd, 055a47c, c966d85)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (flags below)

Note: the first behavioral checker was killed mid-run by a model usage limit (no verdict); a
fresh behavioral checker was dispatched and completed. The audit verdict is from its original run.

## Criterion verdicts

All 6 criteria PASS by both checkers:
- `TASKS_VIEW_SHORTCUT = "alt+shift+space"` (own constant), registered alongside the existing
  toggle; handler discriminates by parsed shortcut identity and always shows (never toggles-hide),
  then emits `open-tasks-view`; App listens and switches view. Behavioral additionally verified the
  shortcut string parses in global-hotkey 0.8.0 (so the startup `.expect` cannot panic) and that
  `listen` is permitted by the resolved ACL (`core:default` -> `core:event:default`) — capability
  file unchanged.
- List sourced from the SQLite index (`listTasks()` -> `invoke("list_tasks")`, SQL filters
  `kind='task'`); no vault scan in the component. Sort is client-side: deadline asc, nulls last,
  `created` asc tiebreak; verified against ties, all-null deadlines, empty list, and
  input-not-mutated.
- Keyboard-only handlers verified by key-sequence simulation: wrap-around nav, empty-list no-ops,
  Space clamping selection after row removal. Space writes via clamped `updateNote`
  (`setFrontmatter: {done: true}`); Enter opens the T7 editor above the list.
- Tab/Shift+Tab cycle `["all", ...tags]` derived from all open tasks (not the filtered view);
  localStorage persistence read lazily on mount, both read and write try/catch-wrapped.
- Done-toggle proven on disk with an id derived the way the indexer derives it (not one handed
  back by createNote): `done: true` written, body/deadline/tags intact. Index-row half traced
  through unchanged watcher -> debounced reindex -> `done` column.
- typecheck 0, cargo check 0, all four demo scripts 0. Worktree clean; 6 files, zero
  manifest/lockfile/capability/CI touches.

## Flags (block auto-land)

1. **Esc semantics**: Esc returns to the capture view leaving the overlay up; only Ctrl+W hides.
   Literal criterion says "Ctrl+W/Esc closes". Both checkers ruled this satisfies intent — it
   matches the app-wide Esc-goes-back convention (capture modes, field editor, note editor) — but
   it is a wording gap worth your eye.
2. **`done: false` widened to `done !== true`**: quick capture never writes a `done` field, so the
   index stores null; a strict reading would show an empty list forever. Both checkers ruled the
   interpretation correct. Only `done: true` hides a row.

## Informational (no action)

- A persisted category tag that no longer exists on any open task restores to an empty list until
  one Tab returns it to "all".
- A note whose frontmatter `id` differs from its filename stem would make `markDone` throw ENOENT
  (caught, row stays) — unreachable for app-created notes where id === stem.
- `markDone` awaits the write and only removes the row on success; no silent loss on failure.

## Manual runtime verification outstanding

Live watcher -> SQLite row write after a toggle; localStorage surviving a real app restart; the OS
actually granting the `alt+shift+space` registration. The two static risks behind these (shortcut
parsing, event-listen ACL) were closed by the behavioral checker.
