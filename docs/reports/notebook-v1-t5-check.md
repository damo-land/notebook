# Check report: notebook-v1 T5 — SQLite index

Date: 2026-08-28
Branch: anchor/notebook-v1-t5 (commits a2ccb48, 4efaf01; rebuild merge ffad792)
Verdict (round 2, after rebuild vs main): behavioral PASS / audit PASS — verified, queued at /anchor:land (tripwire)

## Round 2 additions (post T4-conflict rebuild)

- Merge resolution of src-tauri/src/lib.rs verified as pure superset: all 6 main-side
  commands byte-identical, all 10 functions appear exactly once, handler list valid.
- Watcher proven live by behavioral checker (file write → count 0→1 via notify+debounce).
- TS↔Rust parity re-verified: vault-dir resolution, flat layout, frontmatter dialect.
- New minor flag: reindex uses INSERT OR REPLACE on notes but plain INSERT on notes_fts —
  duplicate note ids would desync count + leave stray FTS row; unreachable with current
  timestamped filename scheme. Noted, no action for v1.

## Round 1 (pre-rebuild, superseded but findings stand)

## Criterion verdicts

All 5 criteria PASS by both checkers:
- Db at `app_data_dir()/index.db`, structurally independent of vault dir; schema exact match (notes/tags/notes_fts FTS5).
- Start reindex + notify watcher wiring verified statically; audit additionally proved the populated-db repeat-reindex path (DELETE-then-repopulate FTS5) via a standalone scratch crate — a case the shipped test doesn't cover. TS↔Rust frontmatter parsers byte-compatible.
- Rebuild test substantive: real `fs::remove_file` + existence assert, SELECT COUNT vs independent read_dir scan — not hardcoded. 3==3, exit 0.
- TS wrappers exact signatures; all SQL parameterized (`params![]`), FTS tokens quoted — no injection surface found.
- typecheck 0, non-vacuous (new file in --listFiles).

Behavioral extra scratch coverage: non-.md skipped, FTS injection input safe, done-task alerts suppressed, tag filter works.

## Flags (tripwire drives the queue)

1. Cargo.toml + Cargo.lock (+224): `rusqlite 0.37 [bundled]` (vendors SQLite C source at build — registry-sourced), `notify 8`. Both sanctioned in the task brief.
2. `reindex` exposed as Tauri command + TS wrapper beyond named criteria — minor, serves rebuild/future tasks.
3. Destructive surface audited: reindex DELETEs db tables only; no write/delete path to vault .md files; watcher scoped to vault dir, no exec.

## Manual runtime verification outstanding

Live watcher (edit a note file → index updates) and app-start reindex — verify at next `npm run tauri dev`.

## Merge note (orchestrator)

T4 and T5 both modify `src-tauri/src/lib.rs` (invoke_handler + setup) — expect a small conflict on the second merge; resolve by keeping both command sets.
