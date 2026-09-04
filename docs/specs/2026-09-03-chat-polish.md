# Chat polish: markdown, clickable links, /clear

Status: draft
Source: v0.1.0 testing — chat responses render as plain text (markdown
markup shows raw), URLs aren't clickable in the tasks list, and there is no
way to start a fresh chat conversation (view-restore deliberately returns to
a non-empty transcript; that stays — an explicit /clear is added).

## Goal

- Assistant chat turns render markdown; links anywhere (chat, tasks list)
  open in the system browser, never navigate the overlay webview.
- `/clear` in the chat input wipes the conversation (transcript + SDK
  session) so the next message starts fresh and close/reopen lands back on
  capture.

## Non-goals

- Changing view-restore semantics (conversation still survives close/reopen
  until /clear — decided 2026-09-03).
- Markdown editing/preview in the note editor; linkifying note bodies
  outside the tasks list.
- Chat history persistence to disk.

## Riskiest assumption

Rendering LLM output as markdown in a Tauri webview without opening an XSS
hole: the renderer must not emit raw HTML from model output, and link opens
must be scheme-validated in Rust — a hostile link must not reach
`open`/the webview.

## Tasks

### T1: Markdown rendering in chat + external link opener
- Type: ship
- Status: verified
- Branch: anchor/chat-polish-t1
- Escalation: required — new npm dependency (react-markdown, pinned).
- Checkers: behavioral PASS / audit PASS — flags: informational only
  (lockfile = pure react-markdown transitives, no new install scripts;
  open_external allowlist verified bypass-free; +68 CSS lines styling) —
  detail in docs/reports/chat-polish-t1-check.md; escalation blocks
  auto-land
- Acceptance criteria:
  - `react-markdown` (exact pinned version) added to `package.json`
    dependencies; `npm install` + `npm run build` succeed.
  - Assistant turns in `src/components/chat-view.tsx` render markdown
    (headings, bold/italic, inline code, fenced code blocks, lists, links);
    user turns remain plain text. Raw HTML in model output is NOT rendered
    as HTML (react-markdown's default skip — cite/assert the configuration;
    no `dangerouslySetInnerHTML` anywhere in the diff).
  - New Rust command `open_external(url)` in `src-tauri/src/lib.rs`: accepts
    only `http://`/`https://` URLs (case-insensitive scheme check), rejects
    everything else with an error, opens via macOS `open`; unit test covers
    accept/reject cases without spawning (validation split from the spawn).
  - Anchor clicks inside rendered markdown call `open_external` and
    `preventDefault` — the webview never navigates (no criterion-satisfying
    path via `target=_blank` or default anchor behaviour).
  - `cargo test` in `src-tauri/` and `npm run typecheck` pass.

### T2: Clickable links in the tasks list
- Type: ship
- Status: todo
- Branch: —
- Escalation: none
- Blocked by: T1 (uses `open_external`).
- Acceptance criteria:
  - New pure helper (e.g. `src/lib/linkify.ts`): splits a string into
    text/URL segments for `http(s)://` URLs; covered by assertions in an
    `npx tsx` demo script or existing assertion-script pattern (bare URLs,
    URL mid-sentence, no URL, trailing punctuation not swallowed).
  - `src/components/tasks-view.tsx` renders task titles through the helper:
    URLs become clickable elements that invoke `open_external`; clicking a
    link neither toggles the task checkbox nor moves keyboard focus/selection
    (existing keyboard flow unchanged).
  - `npm run typecheck` passes; the demo/assertion script passes.

### T3: /clear command in chat
- Type: ship
- Status: landed
- Checkers: behavioral PASS / audit PASS — flags: none
- Branch: anchor/chat-polish-t3
- Escalation: none
- Acceptance criteria:
  - Typing `/clear` (submitted as the whole input) in the chat view resets
    the conversation: transcript emptied, stored SDK session id and any
    pending history dropped — the next message must start a new SDK session
    (no `session`/`resume` sent on the following turn).
  - The reset logic is a pure function (in `src/lib/chat-transcript.ts` or a
    sibling) with assertions in the established `npx tsx` script pattern:
    clear empties turns + session; next-turn request carries no session id.
  - After `/clear`, closing and reopening the overlay lands on capture (the
    existing `restoreView` contract in `src/lib/view-restore.ts`:
    `transcriptEmpty: true` → `"capture"` — assert via the existing
    view-restore demo/assertion path or a new assertion).
  - `/clear` shows as a recognized command wherever chat input slash hints
    exist (if the chat input has no slash-hint UI, a one-line hint in the
    empty-transcript state is sufficient).
  - `npm run typecheck` passes.

## Holds

- [ ] (none yet)
