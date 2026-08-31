# Check report: overlay-focus-and-inline-actions T2 — Inline slash menu + task done affordance

Date: 2026-08-30
Branch: anchor/overlay-focus-and-inline-actions-t2 (commit 7ad69c2)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (minor flags)

## Criterion verdicts — all PASS, both lenses

- **Inline trigger anywhere**: `/` keydown at any caret position opens the menu; the only exception
  is the deliberately preserved empty-input palette. The behavioral checker re-shot the menu live
  from the branch (`Verify robot /ta` mid-line, filtered to `/task`) — evidence is reproducible,
  not stale.
- **The open/close rule** (stated in the module header, verified by both lenses): the menu opens
  ONLY on a typed `/` keydown — paste fires no keydown, so pasted URLs can never trigger it. The
  query is the text between that `/` and the caret; open-ness is *derived* (query prefix-matches an
  action or the menu doesn't exist), so no-match self-hides and nothing but an applied action ever
  rewrites the body. `Buy robot /data` saves verbatim.
- **Exact-span removal**: proven including the duplicate-text case — with `call /al and /al again`,
  applying at the second span leaves the first intact. Nothing else in the body is touched.
- **Per-mode actions**: task → deadline/category/alert (existing field editors); plain → the four
  mode commands + alert; knowledge → none (unchanged from before). Applying a mode command mid-line
  keeps the body (span removed) — deliberate, since mid-line text is real content; the empty-input
  palette still clears, byte-identical to main.
- **Palette kept, not unified**: block-by-block diff confirms palette navigation, mode-Esc and
  Enter-saves handlers byte-identical to main. The old line-start field-selector blocks were
  *replaced* — subsumed by the inline menu, declared in advance, and verified genuinely subsumed
  (deadline/category/alert all reachable).
- **Done ring**: a real `<button>` with aria-label, `onClick` → the SAME `markDone` Space calls —
  audit confirmed only one `updateNote`/`setFrontmatter` site exists in the file, so click and Space
  cannot drift. `onMouseDown` preventDefault keeps list focus so Space works after a click.
  `tasks-view-demo.ts` byte-identical to main and passing.
- **Zero Rust diff** (`git diff main...HEAD -- src-tauri/` = 0 lines); typecheck 0; cargo check 0;
  all 7 demo scripts pass individually; worktrees clean; no processes left by either checker.

## Flags (minor)

1. `.task-done-ring` hardcodes `rgba(255,255,255,.3/.55)` instead of using the `--hairline`/
   `--text-secondary` tokens — same alpha family, but a token would keep the system coherent.
   One-line cleanup for any future styling pass.
2. The dev-only shoot hook now types `SHOOT_TYPE` per character with a synthetic keydown before
   each insert (needed to stage typed-only UI). Audit verified it is confined to the debug-gated
   hook path, which this branch provably did not alter (zero Rust diff).
3. Evidence PNGs are gitignored (by design); the behavioral checker reproduced one live instead of
   trusting the stored files.
4. During audit, port 1420 was briefly held by the sibling T1 worktree's run — correctly left alone.

## Manual steps for the user (also the land exercise)

- **Inline menu**: alt+space → `/task` Enter → type `Buy microduck robot ` then `/dea` → menu
  appears filtered to deadline → Enter → deadline editor opens, body reads `Buy microduck robot `
  with no `/dea`. Type `/data` → menu vanishes at `da`, text stays. Esc with menu open closes only
  the menu. Paste a URL → no menu.
- **Click-to-done**: tasks view → click the ring at a row's left → row disappears, `done: true` in
  the note; Space still does the same.
