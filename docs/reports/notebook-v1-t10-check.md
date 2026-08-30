# Check report: notebook-v1 T10 — Vault search mode

Date: 2026-08-29
Branch: anchor/notebook-v1-t10 (commits cf7d455, cb3b425, 16bfd38)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (informational flags)

## The finding that mattered

`search_notes` did **not** cover tags before this task, despite the criterion requiring it.
`parse_note_file` strips frontmatter before the body reaches `notes_fts`, and the only other clause
was `title LIKE` — so a tag name was unreachable from search. The builder captured the test red first
(`query "gardening" -> []` vs expected `["...tomatoes"]`), then added
`OR id IN (SELECT note_id FROM tags WHERE tag LIKE ?2)`, reusing the existing `?2` bind.

## Criterion verdicts

All 4 criteria PASS by both checkers.

- Palette `search` entry un-disabled (`chat` correctly left disabled for T14); Enter routes through a
  new `runCommand` dispatcher; `view` gains `"search"` following T8's established pattern. Per-keystroke
  `searchNotes` in a `useEffect` with a `cancelled` flag discarding stale responses. Rows show
  title-or-id, kind chip, and date. Cap verified real: 25 matching notes indexed, backend returned 25,
  frontend sliced to 20.
- ↑/↓ wrap, Enter → `openNote` (editor renders above search, so Esc from the editor drops back into
  search), Esc → back to capture with the overlay up, Ctrl+W hides — all using the same
  `preventDefault`/`stopPropagation` pattern as the tasks view so the global keymap doesn't double-fire.
- **Sabotage-proven**: deleting the tag clause in an isolated clone made the test fail at exactly the
  tag assertion — the assertion bites. The test also re-reads the fixture to assert the tag term is
  genuinely absent from that note's body and title, so the isolation is enforced rather than claimed.
- typecheck 0, cargo check 0, cargo test 5/5 (no pre-existing test regressed), all six demo scripts green.

## Adversarial probing (behavioral, beyond the committed test)

Multi-word queries in both orders; a note matching by both body and tag returned **once**, no duplicate
row; case-insensitivity on both paths; punctuation; empty/whitespace/tab-newline → no wildcard fire; and
23 FTS5/SQL syntax payloads (`"`, `*`, `OR`, `AND`, `NOT`, parens, `NEAR`, `^x`, `-x`, `x:`, `'`, `;`,
`\`, `notes_fts`, `x' OR '1'='1`) — zero errors, zero garbage. Token-level quoting holds.

## Flags (informational, none blocking correctness)

1. **No SQL `LIMIT`** — the ~20 cap is applied client-side after SQLite returns every match, so the IPC
   payload is unbounded. Fine at personal scale; a `LIMIT` would be a one-line improvement.
2. **LIKE wildcards unescaped** — a query of `%` or `_` matches every note. Inherited from the
   pre-existing title clause, not introduced here. Doesn't throw; just surprising.
3. **Multi-word queries can never match a tag** — the tag clause is a single LIKE over the whole trimmed
   query. Self-documented as a PoC limit; single-token tag matching (what the criterion exercises) works.
4. Searching is strictly read-only — no vault writes in the new frontend code.
5. The shared query also backs the MCP `search_notes` tool and enrichment's related-notes lookup; the
   change is additive (`OR`, not `UNION`), preserves ordering, and cannot produce duplicate rows, so
   both consumers are unaffected. The pre-existing `index_rebuild` search assertion still passes.

## Known behaviour, deliberately not fixed

`SearchView` remounts when the editor closes over it, so Esc-ing back from an opened hit lands on an
empty search box. Matches the tasks-view model; preserving the query would mean lifting state into App,
which the brief ruled out. Documented in-code.

## Unproven without launching the app

No React test infrastructure exists and the app was not launched, so criteria 1 and 2 rest on tracing
the handler code paths and the real `searchNotes`/`openNote`/keymap wiring they call. Actual focus
behaviour, live event ordering, and visual rendering were not exercised.
