# T3 check — Chat survives its own answer

Branch: anchor/stash-installable-app-t3 (commits 37a7168, d962c66)
Verdicts: behavioral PASS / audit PASS. Task verified; flags below block
auto-land (queues at /anchor:land).

## Flags

- State-composition consequence (audit's requested desync analysis): the
  transcript is monotonic for the session (never cleared), so after the first
  chat message every overlay reopen lands in chat view, and while the chat
  view is up `ChatActive` stays true — click-outside/resign-key auto-hide is
  effectively retired until the user Esc's back to capture. This is the
  literal composition of criteria 1+2 as written, not a coding bug: plain
  capture's resign-hide is untouched, Esc/Ctrl+W always hide, and a hung
  turn self-heals (CHAT_TIMEOUT 180s errors the command → streaming flag
  clears → set_chat_active(false)). Flagged so the user consciously accepts
  the UX trade: chat persistence vs. click-outside dismissal while in chat.
  Possible later tweak: a "clear chat" action or auto-expiring transcript.
- Capabilities file lists no per-command permissions for any app command
  (pre-existing pattern); `set_chat_active` is treated like every shipped
  command. Not a new risk; noted because live IPC couldn't be exercised
  headlessly.

## Evidence highlights

- Guard only in the Focused(false) resign handler (lib.rs:1376-1385, atomic
  bool default false); `hide_overlay` command path never consults it —
  Esc/Ctrl+W verified through keymap.ts:28, App.tsx:256/333.
- Reopen rule: App.tsx:204 `setView(restoreView({transcriptEmpty}))` on the
  overlay-hidden event — the single hide path (toggle included). Initial view
  capture.
- `src/lib/view-restore.ts` pure/DOM-free + `scripts/view-restore-demo.ts`
  assertions pass (repo's established demo-script convention; no JS runner
  exists). typecheck clean, cargo test all green, worktree clean, diff = 5
  files all criterion-relevant (chat-view.tsx hunk comment-only).
