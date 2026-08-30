# Check report: durable-note-writes T2 — Enrichment compare-and-swap + sidecar stdin guard

Date: 2026-08-29
Branch: anchor/durable-note-writes-t2 (commit 45b604a)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (Escalation: required)

Note: the behavioral run was repeatedly killed by machine sleep (environmental) and was finally asked
to write its verdict before any further tool call. It had already established the load-bearing
evidence by then.

## Criterion verdicts

All eight criteria PASS by both lenses.

- **Temp placement** — `join(dirname(path), '.' + basename(path) + '.enrich-' + pid + '-' + randomUUID() + '.tmp')`.
  `dirname` plus a `basename`-derived leaf (which can never contain a separator) cannot escape the
  note's directory. The builder honestly flagged that its demo asserts only that no temp *remains*,
  not where it was created — so the checker closed that gap directly, instrumenting a scratch copy
  with the note nested at `<vault>/nested/deep/` and observing the real path:
  `…/nested/deep/.20260828-140000-race.md.enrich-88440-<uuid>.tmp`. Same directory, leading dot,
  terminal `.tmp`, never `*.md`.
- **`.tmp` can never be indexed as a note** — verified against the indexer's actual predicate
  (`src-tauri/src/index.rs:116`, `extension() != Some("md")`) rather than assumed. Both lenses checked
  this independently.
- **CAS** — `enrichNote` captures raw bytes (`readFile` → Buffer) at job start; `casWrite` re-reads
  immediately before the rename and throws unless `current.equals(expected)`. Abort verified by sha256
  comparison: file byte-identical to the racer's bytes, length unchanged, `alerted: true` intact,
  nothing appended, no `enriched` marker. A re-read failure (note deleted mid-job) is also treated as
  a conflict — "a missing file is definitionally different bytes".
- **Ordering** — write temp → re-read → compare → abort-or-rename. The only step after the comparison
  is the `rename(2)` syscall itself, so the exposed window is as small as it can be.
- **Distinguishable abort** — exported `EnrichConflictError` with `code = "enrich_conflict"`. Asserted
  in both directions: an abort *is* one, a model failure *is not*.
- **No temp left behind** — confirmed by `readdir` at all three directory levels on the abort, failure
  and success paths.
- **Stdin guard** — the checker spawned the real sidecar and sent five payloads. `null`, `[1,2,3]`,
  `"just a string"` and `42` each drew `{"id":null,"ok":false,"error":"request must be a JSON object"}`;
  malformed JSON drew `invalid JSON`; a following request returned `pong`. Pre-fix, the process simply
  died and answered nothing.
- Both typechecks 0; free enrichment demo 0; mcp and free chat demos 0; all six pre-existing root demos
  0; `cargo check` and `cargo test` (7 suites) green — this task edits no Rust and broke none.

## The race proof bites — independently confirmed

This was the central question, given a previous task in this project shipped an assertion that passed
both before and after its fix.

The checker reverted the fix itself in a scratch copy (`casWrite` → plain `writeFile`, and the
non-object stdin guard removed) and re-ran: **exit 1, 14 assertion failures**, led by
`FAIL: the concurrent 'alerted: true' write survives the enrichment job`, alongside
`FAIL: no 'enriched' marker after an aborted write`, `FAIL: nothing was appended on the abort path`
and `FAIL: the abort throws EnrichConflictError (got: no error at all)`. The unmutated scratch copy
ran 59 ok / 0 FAIL. The audit lens did the same thing a different way — running an equivalent repro
against main's pre-fix `enrichNote` in a throwaway worktree and observing `alerted: true present? false`.

## Self-corrected instrumentation, worth recording

Mid-run the checker's own probe produced 3 failures; it diagnosed them as its own bug (a `require()`
in an ESM file throwing outside `casWrite`'s try, leaving a temp the branch's own code would have
unlinked) and attributed them to the harness rather than logging them against the branch. The
corrected harness reported `HARNESS_FAILURES=0`.

Separately, the builder caught one of *its own* new assertions being wrong — "the frontmatter block is
extended, not rewritten" fails legitimately, because merging a tag re-serializes the block — and
replaced it with a body-bytes-verbatim prefix comparison. The audit lens judged the replacement
equivalent-or-stronger, not a quiet weakening, and confirmed no pre-existing assertion was removed
anywhere in the patch.

## Flags

1. **Wire-level discriminator is a message-string prefix.** In-process callers get
   `EnrichConflictError` / `.code`, which is what the criteria required. Across the stdio boundary
   `main.ts` flattens every error to `err.message`, so the only discriminator is the `enrich conflict:`
   prefix — a future wording change would break it silently, with no type-level protection. The builder
   deliberately did not add a `code` field to the `{ok, error}` wire shape on the grounds that nothing
   reads it yet and it would be an undocumented protocol change. Reasonable, but worth knowing.
2. **File mode**: `rename` gives the note the temp's mode — `0666 & ~umask`, i.e. 0644 by default,
   which matches what the app's own notes already carry. Same class of tradeoff as T1's.

## Recorded follow-up (out of scope here, sibling task owns the Rust side)

The enrich worker at `src-tauri/src/lib.rs` matches on `(ok, status)` and lumps a conflict into the
generic `"[enrich] {}: job failed, note left untouched"` log. That line is *true* for a conflict but
cannot distinguish one. If conflicts should be logged or counted separately, the Rust side needs to
match the `enrich conflict:` prefix — which is exactly the fragility flagged above. Both lenses
confirmed this is genuinely outside this task's fenced scope, not a criterion left unmet.

## Unproven without launching the app

The Rust worker's end-to-end conflict behaviour (`pending_jobs`/`already_enriched` were read and the
on-disk file state asserted, but the Rust query was not executed against a live index); a genuine
wall-clock race against the real 30s alerts scheduler, rather than the deterministic `runPrompt` seam
used here; cross-filesystem `rename(2)`, argued from the path derivation rather than exercised across a
device boundary; and the `--real` model path, deliberately not run.
