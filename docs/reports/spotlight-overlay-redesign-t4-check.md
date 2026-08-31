# Check report: spotlight-overlay-redesign T4 — Visual design

Date: 2026-08-30
Branch: anchor/spotlight-overlay-redesign-t4 (commits dd55386, 9b4ed61)
Verdict: behavioral FAIL / audit FAIL — **both on the same single clause, both explicitly passing
every other criterion**. Orchestrator ruling below: spec defect in evidence location, resolved by
recording here; task treated as verified, queued at /anchor:land with the live manual pass as the
land condition.

## The one failing clause, and the ruling

The keyboard-behaviour criterion required "the pre-existing demo scripts passing **plus a documented
manual pass**". Both checkers confirmed the verifiable half completely: all six demo scripts green,
`cargo test` 15/15, and — decisive — **every `onKeyDown` body byte-identical to main** (the only JS
addition is the disclosed presentational `scrollIntoView` follow effect in tasks and search). What
neither could find is a manual-pass document *in the tree*. The behavioral checker stated: "if the
builder's report to you contains it, this clears — I cannot see it."

It does. The builder documented the full pass in its hand-off report; the spec never said where the
document must live, and T2's click-outside criterion ("a documented manual step in the report") was
accepted on exactly this pattern. Recording it durably here closes the gap. The *performance* of the
pass requires a human — no Accessibility grant exists, so no agent on this machine can press a key —
and is therefore a land-time step for the user, exactly like T2's click test.

### The documented manual pass (~3 minutes, in `npm run tauri dev`)

1. Alt+Space → type text → `/` at line start opens the field selector; ArrowUp/Down cycle, Enter
   opens the field, Esc closes it.
2. Empty input → `/` → palette opens; arrows wrap selection; type to filter; Enter on `task` enters
   task mode (amber TASK marker); Esc back to plain.
3. Enter on a typed note saves and dismisses; Shift+Enter inserts a newline and the window grows.
4. `/search` → type; arrows move the selection bar (list scrolls with it past ~8 rows); Enter opens
   the hit in the editor; Esc back.
5. Tasks hotkey → arrows move selection (row scrolls into view in a long list), Tab/Shift+Tab cycle
   the `#filter`, Space marks done (row leaves), Enter opens the editor, Esc back, Ctrl+W hides.
6. `/chat` → Enter sends, Esc leaves keeping the transcript. In the editor: Enter/Cmd+S saves,
   Shift+Enter newline, Esc discards.

## Everything else — PASS by both lenses

- **Typography**: `.overlay-input` at 22px in the system stack; zero monospace anywhere in `src/`
  (grep-verified by both checkers). Type scale 22/15/12; colour system is text alpha on the material
  (.96/.55/.35), hairlines at .10, one selection fill at .14 white, four accent colours as plain
  coloured text.
- **Chrome**: input has `background: transparent; border: none; border-radius: 0`. Every card, chip
  pill, hint footer and old `#2a2a2a`-era fill deleted from CSS *and* markup — `chip-hint`,
  `tasks-hint`, `tasks-footer` return zero grep hits.
- **Placeholders**: "Note…", "New task…", "Search…", "Ask your notes…". No removed hint reappears.
- **Transparency**: `html`, `body`, `#root` all explicitly transparent.
- **Five views**: all evidenced by fixture-only screenshots; consistent language across them.
- **T3 machinery survived the CSS rewrite** (audit): `.overlay-motion` untouched; `offsetHeight`
  measurement unaffected by the padding changes; and the second commit made content own the 96pt
  floor — before: `requested 81 → applied 96` (content under-reported), after: `requested 96 →
  applied 96` (content and clamp agree).
- **Reproducibility** (behavioral): re-shot the capture view from the branch with the same seed
  text; result matched the stored PNG — evidence is live, not stale.
- **Provenance**: no residue of the `git checkout 3eca99e -- src` flip used for the before shot;
  diff vs main is exactly the six fenced files; no manifest/lockfile/Rust/CI touches.
- typecheck 0, cargo check 0, worktree clean, port free, no survivors — both checkers.

## Flags

1. **Privacy gap, confirmed real with blast radius mapped (follow-up item, correctly out of this
   task's fence)**: TS-side `getVaultDir` (`src/lib/vault/index.ts:215`) ignores
   `NOTEBOOK_VAULT_DIR`; only the Rust index honours it. TS write paths — capture-save, note-editor
   save, task done-toggle — resolve against the REAL vault even under the harness. Search/chat go
   through the Rust-backed index API and are safe. During the build this leaked the user's one real
   note into an editor screenshot; the builder deleted it, re-shot under a redirected `$HOME`, and
   the real vault was verified untouched (independently confirmed by the orchestrator). Fix: honour
   the override in `getVaultDir` so one env var governs both sides.
2. The builder's report carried a security-classifier warning; the orchestrator independently
   verified its headline claims (commits, clean tree, six-file diff, port, vault untouched) and the
   audit checker verified the warned methods left zero residue. Judged: disclosed, defensible,
   privacy-protective methods.
3. During unlocked-screen shoots the panel steals key focus; two captures caught stray user
   keystrokes and were retaken clean. Inherent to shooting a key-stealing panel on a live machine.
4. Builder's honest self-assessment of remaining distance to real Spotlight: no icons/thumbnails in
   rows, selection bar is white-alpha rather than the user's accent colour, and the 96pt Rust window
   floor keeps the empty panel slightly taller than Spotlight's bar (mirrored in CSS and centered so
   it reads intentional).

## Human-only remainder

The live look of the material (no capture can show compositor blur), perceived typography quality on
real vibrancy, and the physical keyboard pass above. All land-time, all the user's.
