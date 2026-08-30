# Durable Note Writes

Status: done
Source: Three verified defects can silently lose data — enrichment writes from a 180s-stale read (destroying an `alerted:` marker or a user edit), every note writer can truncate a file on a mid-write crash, and two sidecar holes hang or kill the process.

## Goal

No write can lose data. Every note write is atomic (temp file + rename, same
directory). The two background writers — enrichment and alerts — abandon their
write if the file changed since they read it; the user's own writes always win
with no precondition. The sidecar survives hostile input and a bad byte on its
pipe.

## Non-goals

File locking, lock files, a write-ahead journal, multi-process coordination, or
in-session retry after an abandoned job (an abandoned enrichment waits for the
next app start, matching existing failure-safe behaviour). Also out of scope:
the other standing v1 flags — unscoped WebFetch grant, vault-escape reads not
proven blocked, transcript scrollback keyboard reachability, sidecar-death
detection and restart.

## Riskiest assumption

That "abandon if changed" cannot starve enrichment permanently — a frequently
edited note could abandon on every attempt and never enrich. It retries on next
app start and the user must be editing during each run, but this is unproven.

Closely related implementation trap: `rename(2)` is only atomic within a single
filesystem, so the temp file MUST be created in the same directory as the target
note, never in `/tmp` or the app data dir.

## Context for both tasks

Verified by grep on main — there are exactly three physical note-write sites:

| Site | Writer | Window between read and write |
|---|---|---|
| `src-tauri/src/alerts.rs` `mark_alerted` | alerts | microseconds |
| `src-tauri/src/lib.rs` `vault_write_file` | every frontend write (capture, editor, task done-toggle — all TS vault writes funnel here) | n/a, user is the authority |
| `sidecar/src/enrich.ts` `enrichNote` | enrichment | **up to 180s** (`ENRICH_TIMEOUT`) |

The two tasks below are file-disjoint and can run in parallel: T1 touches only
Rust (`alerts.rs`, `lib.rs`), T2 touches only the sidecar (`enrich.ts`,
`main.ts`).

## Tasks

### T1: Atomic Rust writes + alert precondition + reader-loop survival
- Type: ship
- Status: landed
- Branch: anchor/durable-note-writes-t1
- Escalation: required — rewrites the write path for every frontend note write (capture, editor, task toggle); a defect lands as lost or truncated notes in the user's real vault.
- Checkers: behavioral PASS / audit PASS — 5/5 mutations caught, each targeted; sensitivity check independently reproduced by both lenses (plain `fs::write` → 8 torn reads / 202; helper → 0 / 200). Flags: none blocking. Disclosed tradeoffs of write-temp-and-rename: note file permissions reset to defaults on save, and a symlinked note path is replaced rather than written through. `notify`-only-if-marked verified by control flow, not behaviourally.
- Acceptance criteria:
  - A single helper in Rust performs atomic writes: it creates a temp file **in the same directory as the target path** (not `/tmp`, not the app data dir), writes the full contents, then renames it over the target. A test asserts the temp file's parent directory equals the target's parent directory.
  - `vault_write_file` in `src-tauri/src/lib.rs` uses that helper and has **no** precondition — it always overwrites, because the user is the authority for their own writes. Its signature and error-string shape are unchanged, so existing frontend callers still compile and behave identically.
  - `mark_alerted` in `src-tauri/src/alerts.rs` uses that helper **and** takes a precondition: it captures the file's exact bytes when it reads, and immediately before renaming verifies the target's current bytes still equal what it read; if they differ it makes no write and returns a distinguishable error (not the same variant as an I/O failure), leaving the file byte-identical.
  - A Rust test in `src-tauri/tests/` proves the `mark_alerted` precondition: seed a note, read it, mutate the file on disk to simulate a concurrent writer, then run the marking path and assert (a) no write occurred, (b) the concurrent writer's content is intact byte-for-byte, and (c) the returned error is the precondition variant.
  - A Rust test proves atomicity is observable: after a write through the helper, the target contains either the complete old content or the complete new content, and no temp file is left behind in the directory on either the success or the failure path.
  - The sidecar stdout reader loop in `src-tauri/src/lib.rs` (currently `BufReader::new(stdout).lines().map_while(Result::ok)`) no longer terminates on a read error — a non-UTF-8 or otherwise unreadable line is skipped and logged, and subsequent lines are still routed. A test or a documented scratch run demonstrates that a bad line does not stop later lines from being processed.
  - `source "$HOME/.cargo/env" && cargo check` exits 0 and `cargo test` passes, including all pre-existing test files (`alert_scheduler`, `enrich_pending`, `index_rebuild`, `search_notes`).
  - `npm run typecheck` exits 0.

### T2: Enrichment compare-and-swap + sidecar stdin guard
- Type: ship
- Status: landed
- Branch: anchor/durable-note-writes-t2
- Escalation: required — rewrites the write path of the background enrichment job against the user's real notes; a defect lands as lost note content.
- Checkers: behavioral PASS / audit PASS — race proof independently confirmed to bite (fix reverted → 14 failures led by the `alerted: true` survival assertion; unmutated → 59 ok / 0 fail); temp placement observed live in a nested note dir. Flags: the cross-process conflict discriminator is a message-string prefix (`enrich conflict:`) with no `code` field on the wire response shape — a wording change would break it silently.
- Acceptance criteria:
  - `enrichNote` in `sidecar/src/enrich.ts` writes atomically: it writes a temp file **in the same directory as the target note** (not `/tmp`), then renames it over the target. No temp file remains on either the success or the failure path.
  - `enrichNote` takes a compare-and-swap precondition: it captures the note's exact bytes at job start, and immediately before renaming re-reads the target and aborts if the bytes differ. On abort it performs **no write**, leaves the file byte-identical, and writes **no** `enriched` frontmatter marker — so the existing startup pass re-selects the note on the next app start.
  - The abort path is distinguishable from a model/parse failure in the value or error `enrichNote` produces, so a caller can tell "someone else touched the file" from "the job failed".
  - **The race proof**: an assertion in `sidecar/scripts/enrich-demo.ts`'s free (stubbed, unpaid) path drives a concurrent write during the model call — writing an `alerted: true` frontmatter line into the note mid-job, the way the alerts scheduler would — and asserts that after the job completes the `alerted: true` line is still present in the file. This assertion must FAIL against the pre-fix behaviour; state in the report how that was confirmed (e.g. by reverting the fix in a scratch copy and observing the failure).
  - A stubbed assertion covers the unchanged-file case: when nothing touches the note during the job, enrichment still writes normally and sets the `enriched` marker, so the fix does not disable enrichment.
  - A literal `null` line on the sidecar's stdin (`sidecar/src/main.ts`) no longer crashes the process: it draws a structured error response, and a subsequent `{"id":N,"method":"ping"}` on the same process still returns `pong`. The same holds for a JSON array and a JSON string — any non-object payload. An assertion in the demo's free path spawns the real sidecar process and proves it.
  - `npm --prefix sidecar run typecheck` exits 0 and `npm run typecheck` exits 0.
  - The free (unpaid) enrichment demo exits 0. Do NOT run the demo's `--real` flag or `npm run sidecar:smoke` for this task — no paid LLM call is needed to verify any criterion above.

## Holds
<!-- decision forks recorded by agents; user resolves at /anchor:land -->
