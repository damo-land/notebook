# Check report: notebook-v1 T9 — Alerts → macOS notifications

Date: 2026-08-29
Branch: anchor/notebook-v1-t9 (commits 52d2e0f, 464adfd, 9e9f8ed)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (tripwire + flags)

Note: three checkers were killed mid-run by repeated machine sleep (environmental). Sleep was
then held off with `caffeinate` and a fresh behavioral checker completed. Audit completed on its
original run.

## Criterion verdicts

All 5 criteria PASS by both checkers.

- **Alert entry**: `fieldsForMode` gives task `[deadline, category, alert]`, plain `[alert]`.
  Unparsed entries are structurally unsaveable (`alertAt?.iso ?? undefined` + `!== undefined`
  guard); the chip shows `alert "<raw>" unparsed`. Behavioral ran 56 additional parser cases
  (12am/12pm, midnight, month + year rollover, leap-day accept/reject, case and whitespace
  variants, 37 rejections) — all correct.
- **Scheduler**: plugin registered, `notification:default` granted, thread loops every 30s,
  first pass runs after the initial reindex so startup IS the catch-up.
- **No repeats**: `alerted: true` written to frontmatter (not the index — an index flag would be
  wiped by `reindex`, re-firing every past alert). Behavioral wrote its own independent Rust test:
  past-due selected exactly once incl. the `alert == now` boundary, `alerted: false` treated as
  unmarked, future note never selected until due, marked note skipped and left byte-identical,
  and after deleting + rebuilding the index the marker still suppressed firing.
- **Marker preserves the file**: verified against a hostile body (literal `---` line, tab,
  trailing spaces, emoji, no trailing newline) — body bytes identical; a note with
  `alerted: false` has the line replaced, not duplicated; a file with no frontmatter returns Err
  and is left untouched.
- typecheck 0, cargo check 0, cargo test 4/4, all demo scripts 0. Worktree clean, 9 files,
  no test-config tampering.

## Flags

1. **New dependency + lockfile**: `tauri-plugin-notification` pulls 41 transitive crates
   (mac-notification-sys, notify-rust, zbus/zvariant, async-io/executor, rand, tempfile …).
   All registry-sourced, purely additive, no git/path sources, no install hooks.
2. **Capability grant**: `notification:default` — the minimum needed to use the plugin.
3. **Non-atomic write**: `mark_alerted` is a full-file `std::fs::write` with no temp+rename, so a
   crash mid-write could truncate a note. Inherits the pre-existing `vault_write_file` pattern.
4. **Lost-update race**: no lock covers file I/O between the Rust marker writer and the TS vault
   library, so editing a note at the instant its alert fires is last-writer-wins. Single small
   write each side — not byte-level corruption.
5. **Mark-before-notify**: a note is marked before `.show()` is called and stays marked even if
   `show()` errors. Guarantees no repeats; the tradeoff is that a denied notification permission
   silently consumes alerts.
6. **Bare time resolves to today**, never rolling forward — `"9am"` typed at 16:40 lands in the
   past and fires on the next poll. Documented as intentional.
7. **UI discoverability (builder-reported, deliberately unfixed)**: in plain capture the
   `/ for alert` hint only renders once an alert is already set, because the chips row is gated
   on `(mode !== "plain" || alertAt)`. The field is reachable; it is just undiscoverable until
   you already have one. A UI call the builder declined to make unilaterally.

## Manual verification outstanding — exactly one thing

The macOS banner actually appearing. Everything upstream of `.show()` is verified by execution.
Steps: `npm run tauri build`, launch the BUNDLED app (`open src-tauri/target/release/bundle/macos/notebook.app`
— not `tauri dev`, whose unbundled binary has no registered bundle id and commonly no-shows),
allow notifications, capture a note with an alert one minute ahead, wait up to +30s for the
banner, then confirm `alerted: true` landed in the file.

**Retry gotcha**: the note is marked before the banner is shown, so if nothing appears you must
delete the `alerted: true` line before retrying or that note will never fire again.

## Note for CONTEXT.md (orchestrator)

`alerted:` is now an idempotence contract in frontmatter that other tasks must not clobber.
