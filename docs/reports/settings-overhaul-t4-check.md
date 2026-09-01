# T4 check report — settings-overhaul (visual restyle)

Date: 2026-09-01
Branch: anchor/settings-overhaul-t4
Verdict: behavioral PASS / audit PASS — **flags present, auto-land blocked**

## Criteria

All 6 criteria PASS under both lenses (custom selects, full-width rhythm,
button/status spacing, committed screenshot, no shared-CSS regression,
typecheck). Screenshot visually verified by both checkers:
`docs/screenshots/settings-restyle.png` (in the T4 worktree).

## Flags (block auto-land; informational after human approval)

1. `.gitignore` — `screenshots/` narrowed to `/screenshots/` (root-anchored)
   so `docs/screenshots/` becomes committable. Escalation-category by path
   semantics; directly serves the screenshot criterion.
2. `scripts/shoot.sh` — added `settings` to the view allowlist (additive,
   same pattern as tasks/search/chat). Not the test command; no tampering.
3. `src/App.tsx` — routes `STASH_SHOOT_VIEW=settings` → `setView("setup")`,
   dev-only branch behind existing `shoot_view` hook. Pre-existing pattern.
4. `setup-view.tsx` — model-dropdown note now says "sidecar unreachable" when
   the adjacent status line does (was stuck at "checking…"). Presentation-only
   text alignment; was explicitly briefed as in-scope (T1 audit's
   informational note).

No lockfile/manifest/migration/CI/Dockerfile/.env touches. No semantic red
flags (auth, destructive ops, fetch-and-execute, blobs, hooks).

## Notes

- Screenshot shows both providers "checking…" (sidecar never settled during
  the 14s harness run) — Start/copy buttons not visible in shot; their CSS is
  the shared `.settings-btn` exercised by the same stylesheet.
- Screenshot contains the real vault path (/Users/damo/Notebook) — path only,
  no note content.
