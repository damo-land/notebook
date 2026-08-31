# T9 check — Graceful degradation without Claude auth

Branch: anchor/stash-installable-app-t9 (commits ee63937, c045262)
Verdicts: behavioral PASS / audit PASS. Task verified; flags + manifest
tripwire block auto-land (queues at /anchor:land).

## Flags

- Tripwire (manifest): `sidecar/package.json` gains a `"test"` script —
  criterion-serving (criterion 4 requires sidecar tests runnable), no
  dependencies added/removed, no lockfile change beyond it. Informational.
- AUTH_ERROR_PATTERN breadth (pre-existing, unchanged except export): the
  regex is unanchored and runs over interpolated model/tool text — a WebFetch
  result containing "401 Unauthorized" or note content discussing login/OAuth
  could cosmetically mislabel a non-auth failure as "LLM not configured".
  No data impact either way (nothing is written on any failure). Candidate
  cleanup for a later task, not this one.

## Evidence highlights

- Chain: `classifyLlmError` wraps credential-shaped failures in
  `NotAuthenticatedError` (stable prefix "Not authenticated with Claude
  Code.") → main.ts flattens → chat_send returns Err → chat-view.tsx:36-46,
  129-139 renders "run `claude setup-token`" message in-transcript.
- Enrichment: enrichNote throws before any write; enrich.test.ts proves note
  byte-identical, no marker, no temp files; single eprintln per job
  (lib.rs:1096-1104); `dispatched` HashSet prevents session re-queue (read,
  not assumed).
- Non-LLM flows: no invoke/.call() from capture/search/tasks/alerts reaches
  the sidecar; no dialog APIs anywhere in lib.rs. ("Delete" absent from this
  branch's base — T4 ships it; T4's path is SQLite+trash, also LLM-free.)
- sidecar npm test 8/8; root + sidecar typecheck clean; cargo test green;
  worktree clean; no out-of-scope changes.
