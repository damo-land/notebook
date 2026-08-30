# Check report: durable-note-writes T1 — Atomic Rust writes + alert precondition + reader-loop survival

Date: 2026-08-29
Branch: anchor/durable-note-writes-t1 (commits 5c5ce5d, db6750f)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (Escalation: required)

Note: both behavioral runs were repeatedly killed by machine sleep (environmental). The final run
was asked to write its verdict before any further tool call, which is why the verdict is complete
while a few of its own optional probes are explicitly marked not-run.

## Criterion verdicts

All eight criteria PASS by both lenses.

- **Sibling temp placement is correct by construction**: `path.with_file_name(...)` cannot produce a
  path outside the target's directory, including for a bare relative filename — where a
  `parent()`-then-join would yield `""` vs `.` and break. Asserted for a vault path, a nested path
  and a bare name.
- **`vault_write_file` has no precondition**: passes `None`; the `Changed` variant is *unreachable*
  without `Some(...)` since its sole producer sits inside `if let Some(expected) = expect`. Signature
  byte-identical to main; `WriteError::Io` Displays as the underlying `io::Error`, so the
  `format!("write {path}: {e}")` string shape is preserved and the frontend still typechecks.
- **`mark_alerted` CAS**: reads raw bytes (not a lossy string), re-reads and compares immediately
  before the rename, returns `WriteError::Changed` — a variant distinct from `Io` — leaving the file
  byte-identical. A re-read that *fails* is treated as `Changed`, not success: bytes that cannot be
  confirmed must not be overwritten.
- **Atomicity observable**: 200 racing 64 KiB writes against a concurrent reader, zero torn reads.
  The failure-path test targets a directory so staging succeeds and the *rename* fails, then pins
  `ErrorKind::IsADirectory` — without that pin, a never-created temp would satisfy the
  clean-directory assertion just as well.
- **Reader loop**: `map_while(Result::ok)` replaced by `for_each_readable_line`, which logs an `Err`
  and continues; only EOF ends the loop. Proven with a non-UTF-8 line between two good JSON lines.
- cargo check 0, cargo test 13 passed / 0 failed (durable_writes 6 + all four pre-existing files),
  typecheck 0, all six demo scripts green.

## Mutation testing — 5/5 caught, each targeted

| # | Mutation | Caught by |
|---|---|---|
| M1 | sibling placement → `std::env::temp_dir()` | `temp_file_is_a_sibling_of_the_target` |
| M2 | remove the CAS comparison | `mark_alerted_aborts_when_the_note_changed_underneath` |
| M3 | reader loop → `map_while(Result::ok)` | `an_unreadable_line_does_not_stop_the_reader_loop` |
| M4 | skip temp cleanup | failure-path test + CAS test |
| M5 | sensitivity: plain `fs::write` for non-CAS writes | torn-read test |

No mutation passed silently, and **every mutation left the other five tests green** — the tests are
targeted, not blanket-failing. Source restored verbatim after each.

The sensitivity check was reproduced independently by BOTH lenses: audit measured 8 torn reads out of
202 with plain `fs::write` versus 0 out of 200 with the helper. That is what makes the atomicity test
a proof rather than a green light.

## API split — judged necessary, not a testability shortcut

`mark_alerted(path)` was split into itself plus `mark_alerted_with(path, seen)`. The audit lens ruled
on the argument rather than accepting it: with a path-only entry point, an internal read after the
test's simulated concurrent write would see the *already-mutated* file, so the CAS would compare
mutated-against-mutated and always succeed — the race would be inexpressible. Confirmed the production
caller (`take_due_alerts` → `mark_alerted`) still does its own fresh read, and `mark_alerted_with` is
used only by tests.

## Disclosed tradeoffs of write-temp-and-rename (both confirmed by audit)

1. **File permissions reset**: the target inherits the temp's mode (`File::create` defaults), so a
   `chmod`-ed note is reset on save. No `set_permissions` call exists.
2. **Symlinks replaced**: a symlinked note path is replaced by `rename(2)` rather than written
   through. Standard documented behaviour, worth knowing if you ever symlink a note into the vault.
3. `sync_all` before rename means the staged bytes survive a *process* crash; it does not claim
   directory-entry fsync or power-cut safety, and the comment does not overclaim.

## Not run / unproven

- The checker's own independent probes for the CAS, for `vault_write_file`'s missing precondition, and
  for a `*.md` glob over many derived temp names were killed before execution. Each is covered either
  by a builder test the checker confirmed bites, or by a complete control-flow argument.
- **notify-only-if-marked** is verified by control flow only: in `take_due_alerts`,
  `Err(WriteError::Changed) => { eprintln!(...); continue; }` precedes the sole `fired.push(...)`,
  which is reachable only after `Ok(())`. No probe forced a `Changed` abort inside `take_due_alerts` —
  the CAS window is not injectable without editing production code.
- True crash/power-loss durability and cross-filesystem behaviour cannot be proven without a real
  crash. Anything needing the Tauri runtime (the live `vault_write_file` command path, a real
  non-UTF-8 line from a live sidecar) remains unproven — launching the app was forbidden.

## Housekeeping

The checker left a 3.6 GB rsync'd mutation copy under the session scratchpad; the orchestrator removed
it and re-confirmed the worktree clean (`git status --porcelain --untracked-files=all` empty).
