# Check report: notebook-v1 T12 — Knowledge enrichment (background)

Date: 2026-08-29
Branch: anchor/notebook-v1-t12 (commits through the enrichment worker + demo)
Verdict round 1: **SPLIT** — behavioral **FAIL** / audit **PASS** → repair round (Repairs: 1)
**Verdict round 2 (after repair `3a21990`): behavioral PASS / audit PASS — verified, queued at /anchor:land (flags).**

## Round 3 (after rebuild vs landed T9) — behavioral PASS / audit PASS

The branch was reopened at land because its freshness merge conflicted with T9 (alerts) in
`src-tauri/src/lib.rs`. Rebuilt as a union; both checkers re-ran in full.

**Merge integrity — independently verified, not taken on the builder's word.** The builder offered
matching `--stat` output as proof; the audit checker noted `--stat` cannot rule out a same-line-count
swap and read the full content diff against BOTH parents instead. Result: pure additive union. All 11
Tauri commands defined and registered exactly once; `Cargo.toml`/`Cargo.lock`/`capabilities` byte-identical
to main; `alert_scheduler.rs` and `enrich_pending.rs` byte-identical to their single-parent originals
(no test weakening); no conflict markers anywhere. `setup()` ordering correct — initial reindex (L477)
precedes both the enrichment retry pass (L489) and the alert scheduler (L508), so neither first pass
sees an empty index. `cargo test` 6/6 (alerts 3, enrichment 2, index rebuild 1).

### NEW DEFECT — lost-update race between the two frontmatter writers (reproduced, not theorised)

Enrichment can silently destroy T9's `alerted: true` marker, causing a **duplicate macOS notification**.

Mechanism: `enrichNote` reads the file (enrich.ts:307), awaits the model call (L320 — seconds to
minutes, longer with WebFetch), then writes at L351 from the **stale** in-memory object; it never
re-reads. `ENRICH_TIMEOUT` is 180s while the alert poll is 30s, so `alerts::mark_alerted` can write
inside that window and be overwritten. The behavioral checker drove this with a stubbed model call
that performs a faithful port of `mark_alerted` mid-call:

```
=== A. RACE: alerts writes `alerted` DURING the model call ===
ok  : note had no alerted marker at start
FAIL: `alerted: true` written mid-call SURVIVES the enrichment write
```

The written file ends up with `enriched:` and `source:` but no `alerted` key at all. Because
`index::due_alerts` (index.rs:262) has **no `kind` filter**, the note is re-selected on the next
30s poll, `is_alerted` reads false, and the notification fires a second time — breaking the
exactly-once guarantee documented at alerts.rs:2 and asserted by `fires_past_due_alerts_once_and_only_once`.

**Reachability is narrow**: needs a note that is both `kind: knowledge` AND carries a past-due `alert`,
with the due moment landing inside the job window. The capture UI cannot produce one (knowledge mode
has no fields in v1) and the editor renders frontmatter read-only — so it takes a hand-edited note,
which the feature explicitly supports ("works no matter what wrote the note … or the user's own text
editor").

**The other three directions are safe**, also verified: an `alerted` present before the enrichment read
survives (unknown keys are re-emitted); `mark_alerted` running after enrichment preserves `## Context`,
`enriched` and body bytes exactly (microsecond window, no I/O inside it); and an `alerted` write does
trigger the watcher → `dispatch_enrichment`, but that pass is idempotent (marker read from file +
session-scoped `dispatched` set), so there is no enrichment amplification and no double spend.

Fix options for a follow-up task (NOT done here — outside every T12 criterion): re-read and merge
immediately before writing; or write via temp-file + rename with an mtime/hash precondition; or give
`due_alerts` a `kind` filter so enrichment-eligible notes are not re-selected. The same stale-read
structure is what also lets a user's own edit be clobbered mid-job, so one fix addresses both.

## Round 2 — repair and re-verification

Repair scope was three things and stayed there (audit diffed `528c849..3a21990`: only `package.json`,
`sidecar/scripts/enrich-demo.ts`, `sidecar/src/llm.ts` — no drift into enrichment logic, prompt
wording, link capping, tag handling or append-only mechanics):

1. Root alias gained `--` passthrough.
2. A fail-fast guard keyed on npm's `npm_config_real` residue — if `--real` was requested but
   swallowed, the demo exits 1 with FATAL instead of quietly stubbing.
3. Real-run assertions strengthened from near-vacuous term matching to two halves matching the
   criterion: WebFetch must actually appear in recorded tool calls **against the note's host**, and
   the appended section must carry ≥2 terms drawn from the page's own wording.

The builder dry-ran the new assertions four times **free** with a stand-in before spending anything,
confirming each fires on bad input (no tool call / wrong host / recall-only summary).

Round-2 evidence:
- **Behavioral** ran 13 invocation shapes under a module-resolution hook that hard-blocks the SDK so
  none could spend: every shape either genuinely reached the live path or exited 1 FATAL — no silent
  stub in any form, including `npm run ... --real`, `--real=true`, flag-before/after-other-args, the
  nested `npm --prefix` form, direct `npx tsx`, and `npm exec`. It then spent its one authorized real
  run: 4 genuine WebFetch calls, first against the note's URL, appended section carrying content only
  a fetch yields (the page's h1, its single "Learn more" link, the 301 to iana.org/help/example-domains,
  RFC 2606/6761). It also re-attacked the untouched invariants with its own harness: byte-prefix held
  for multibyte + CRLF + no-trailing-newline bodies; a reply embedding a fake `---id: EVIL kind: task---`
  block could not hijack id/kind or produce a second heading; 8 candidates + repeats + alias + padded
  + hallucinated links collapsed to exactly 3 existing targets; five distinct failure modes each left
  the file byte-identical with no marker.
- **Audit** independently reproduced npm's flag-swallowing mechanics in a sandbox, confirming the guard
  fires in every omission case and cannot raise a false failure (only theoretical vector: an `.npmrc`
  defining an unrelated key named `real` — none exists here). Confirmed `onToolUse` is observation-only:
  options are fixed before the loop, it cannot alter the request or returned text, it is optional and
  defaulted off, and it is wired only in the demo — never in the production enrichment path.

## Open flags for the user (round 1 audit + round 2), none blocking correctness

1. **Unscoped `WebFetch` grant** — the tool is granted whenever the note contains any URL, with no
   SDK-level allowlist limiting it to the note's own URLs; the prompt merely instructs which to fetch.
   The real run visibly followed a link onward to iana.org — correct and useful here, but it is the
   behaviour this flag describes. **Worth an explicit decision.**
2. Non-atomic write; a crash mid-write can truncate a note.
3. Concurrent-write clobber: a job reads once and writes up to 180s later, silently overwriting a user
   edit that lands inside that window.
4. `pending` map entries leak if the sidecar dies before replying; no sidecar-death detection/restart.
5. Brittle real-run assertion: page-term list was calibrated on wording the live page has since
   shortened; it cleared 3 of 6 with a 1-term margin. Builder deliberately did NOT retune it, on the
   grounds that fitting an assertion to output you already hold is the exact failure this repair existed
   to fix. Will need attention if the page drifts again.
6. Same missing-`--` shape exists on `sidecar:smoke` and `sidecar:mcp:demo` aliases — harmless today
   (neither takes a documented flag), reported rather than scope-crept into.

## Still unproven without launching the app (carry forward)

Watcher firing on a real save and reaching `dispatch_enrichment`; a job traversing stdio to a live
sidecar and being routed back by id; the dead-sidecar log path at runtime; the 180s timeout; the
session-scoped `dispatched` de-duplication. The note-is-untouched half of failure-safety **is** proven
empirically, independent of the app.

## Round 1 detail (superseded, kept for history)

Note: several checkers on this task were killed mid-run by repeated machine sleep
(environmental). Sleep was then held off with `caffeinate` and the runs completed.

## Why it failed — no defect was found

The behavioral checker passed five of six criteria and refused to pass the sixth because it
could not be **executed**, not because anything was wrong with it:

**C3 — "If the note contains a URL, enrichment fetches it (SDK web tools) and the appended
section summarizes the target" — UNVERIFIED.**
- Wiring proven: with a URL present the code passes
  `{"tools":["WebFetch"],"allowedTools":["WebFetch"],"maxTurns":8}` to `runPrompt`, and `{}`
  with no URL. `source` comes from the note's own first URL, never model-supplied. `sdk.d.ts`
  declares all three option names; `tsc --noEmit` passes with excess-property checking.
- Not proven: that a real model actually fetches the page and summarizes it. Those assertions
  live behind the demo's `--real` flag.
- Both attempts to run it were blocked. **The first silently ran stubbed** (see the defect
  below), so no paid call was even spent; the second, using the documented form, was denied by
  the permission classifier and the checker correctly did not work around it.

## Real defect found: `--real` is silently swallowed

`package.json`: `"sidecar:enrich:demo": "npm --prefix sidecar run enrich:demo"` — no `--`
passthrough. So `npm run sidecar:enrich:demo -- --real` reaches the inner npm as an npm flag
rather than reaching tsx, and the demo prints `(stubbed)` while the reviewer believes the real
path was exercised. Orchestrator reproduced and confirmed this. Fix: append `--` to the alias
(or invoke the sidecar script directly).

## What DID pass, and how hard it was pushed

- **C1 queue-on-save** — trigger is the watcher, not a save hook; `vault_write_file` untouched,
  so capture latency is structurally unaffected. Dispatch is non-blocking onto a worker thread.
  Knowledge-only selection proven by `cargo test` and by running the real Rust selector over an
  11-note attacked vault.
- **C2 append-only** — survived direct attack: replies attempting prompt-injection, a full
  replacement frontmatter block, a truncated rewrite and a second `## Context` heading all left
  the original body as an exact byte prefix; injected `---` blocks did not hijack the parser.
  All 11 attacked files round-tripped byte-identically through the real TS parser, and TS and
  Rust agreed on the tag list for a hostile-tag note (comma, newline, brackets, tab, 120-char,
  empty). Sabotage confirmed the committed demo's assertions bite.
- **C4 ≤3 links** — candidates come from the SQLite FTS index, self excluded, capped at 8; a
  reply with 10 link occurrences yielded exactly 3 distinct targets; a reply linking only
  non-existent ids produced **zero** links (de-linked to prose, nothing dangling). Two sabotage
  variants both made the demo exit 1.
- **C5 failure-safe** — a mid-job throw and an unreachable-sidecar throw both left the file
  byte-identical with no `enriched` key; the retry half was proven with the real
  `enrich::pending_jobs` (the same function the startup pass calls), which returned exactly the
  failed note and excluded all nine enriched ones.
- **C6 typecheck** — root 0, sidecar 0, cargo check 0, cargo test 3 passed, stubbed demo 40/40,
  mcp demo pass, all four pre-existing demos 0. Worktree clean.

## Flags (behavioral)

1. **Permission broadening**: `runPrompt` can now auto-approve a built-in SDK tool without a
   prompt. Scoped to `WebFetch`, only when the body contains a URL, max 3 URLs — but it is a
   background process fetching note-derived URLs.
2. `already_enriched` returns `true` for a note it cannot read, permanently skipping it for the
   session (deliberate and logged, but worth knowing).
3. Out-of-scope: the `sidecar_ping` transport refactor to id-based routing. Defensible — a 180s
   enrich job would otherwise steal a ping's reply — but no executed test covers `sidecar_ping`.
4. Non-blocking: an empty `[[]]` passes through untouched; a hand-written scalar `tags:` would be
   replaced rather than merged (the app always writes list form).

## Audit lens (round 1) — PASS, with substantive flags

Audit passed all six criteria (C3 on wiring grounds, its live half deliberately deferred to the
behavioral checker's `--real` run per cost control). It confirmed zero new dependencies, no
lockfile changes anywhere, and no test-config tampering. Its flags:

1. **`WebFetch` is granted UNSCOPED** — `tools`/`allowedTools` are set whenever the note contains
   any URL, with no SDK-level allowlist restricting the fetch to the note's own extracted URLs.
   The prompt merely *instructs* the model to fetch the listed ones. Since fetched-page content
   and note body both become model context, that is a narrow but real prompt-injection / SSRF-shaped
   exposure. Only reachable for notes containing a URL. **Worth a decision at land.**
2. **Non-atomic write** — plain `writeFile`, no temp+rename; a crash mid-write can truncate a note.
3. **Concurrent-write clobber** — a job reads the note once and writes up to 180s later. A user
   edit landing inside that window is silently overwritten (no mtime/hash check). No test covers it.
4. **`pending` map leak** — entries for requests that never get any reply (sidecar dies mid-flight)
   are never removed. Bounded, non-blocking.
5. **No sidecar-death detection/restart** — pre-existing gap, not introduced here; after the child
   dies further calls fail only after a full timeout.

On the `sidecar_ping` refactor, audit ruled it **justified, not decorative**: `Sidecar::call` has
exactly two callers, the Node side dispatches with unawaited `void handle(req)` so a 180s enrich
and a ping genuinely run concurrently, and the old single-channel design produces cross-talk in
exactly that case. Lock ordering checked — `call()` takes `proc` then `pending`, the reader thread
only `pending`, `kill_sidecar` only `proc`; no cycle, no deadlock. Wire format and the 10s ping
timeout are preserved.

Confirmed no frontmatter-injection path: `sanitizeTag` collapses whitespace including newlines, so
a hostile tag cannot open a new key line, and model prose is only ever appended after the
frontmatter block.

## Repair requirement

1. Fix the `--real` flag forwarding so the documented root command actually runs the real path.
2. Produce the C3 evidence: run the real enrichment once against a note containing a public URL
   and capture the output verbatim, showing the appended section summarizes the fetched page.
3. Change nothing else.

## Unproven without launching the app (carry forward)

Watcher firing on a real save; sidecar spawn and stdio round trip; id-routing under concurrency;
`sidecar_ping`; the 180s timeout and write-failure paths; the startup retry pass actually
executing (only `pending_jobs` was run); `[enrich] …` stderr emission.
