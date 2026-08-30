# Check report: notebook-v1 T6 — `/` command palette + task capture

Date: 2026-08-28
Branch: anchor/notebook-v1-t6 (commits 64aba1d, f2b41af)
Verdict: behavioral PASS / audit PASS — verified, queued at /anchor:land (flags)

## Criterion verdicts

All 6 criteria PASS by both checkers:
- Palette: derived-state open condition, greyed search/chat never selectable, "/xyz"+Enter no-op (no bogus notes).
- Task morph: kind chip, true line-start `/` detection (selectionStart), deadline live-parse preview, unparsed deadline shown but omitted from frontmatter, single category tag.
- Save paths write correct kind/deadline/tags via existing createNote; vault round-trip corroborated by vault-demo.
- Esc layering correct: field editor → menu → mode (preventDefault + keymap defaultPrevented guard) → plain (falls through to hide). Ctrl+W always hides.
- Date parser: 18 substantive assertions + checker edge cases ("sat" on Saturday → +7 by design, +0d → today, case/whitespace tolerant, garbage/impossible dates → null); DST-safe (field construction, not epoch math).
- typecheck 0 (strict, unmodified tsconfig). Worktree clean, zero manifest/lockfile/capability touches.

## Flags (block auto-land)

1. **Regression: `/`-leading plain notes unsavable via Enter.** paletteOpen triggers on ANY single-line body starting with `/`; palette branch swallows Enter AND Shift+Enter unconditionally; non-matching text → permanent no-op. Escape hatches: Backspace the `/`, or Esc (wipes body). Pre-T6, such notes saved fine. Fix candidates (later task or T7/T10 touch): only open palette when `/` is the first char typed into an EMPTY input, or let Shift+Enter fall through, or make Enter fall through when no palette match.
2. Palette-open Esc clears input rather than hiding overlay (sub-state semantics change; plain-closed behavior intact).
3. Field-menu open: ordinary typing still inserts into body while menu shows (cosmetic oddity).
4. Minor: `id as Mode` casts rely on implicit COMMANDS/TASK_FIELDS id↔union coupling; knowledge mode has no `/` fields (criteria-consistent).

## Manual runtime verification outstanding

Live palette/mode/Esc keystroke flow — first `npm run tauri dev` pass.
