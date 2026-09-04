# T1 check detail — chat markdown + external link opener

Spec: docs/specs/2026-09-03-chat-polish.md
Branch: anchor/chat-polish-t1 (commits 41c04bf, 801b2c9; src-tauri/src/lib.rs,
src/components/chat-view.tsx, src/App.css, package.json, package-lock.json)

## Verdicts

- Checker A (behavioral, fable): PASS — install/build/typecheck/cargo all
  green; live react-dom/server render through the worktree's react-markdown:
  headings/bold/code/lists/links render, `<script>` and `<img onerror>`
  emerge as escaped text, not DOM; anchor override preventDefaults
  unconditionally and invokes open_external; validation test covers
  mixed-case accepts and javascript:/file:/data:/ftp:/mailto:/empty/
  leading-space/httpx:// rejects without spawning.
- Checker B (audit, sonnet — one machine-sleep interruption, resumed and
  delivered): PASS — lockfile delta is pure additions from react-markdown
  10.1.0's known transitive tree (unified/remark/rehype/micromark);
  `hasInstallScript` count unchanged (3 pre-existing); no rehype-raw
  anywhere; open_external is a true allowlist on a lowercased string, argv
  spawn of /usr/bin/open (no sh -c → metacharacters inert), no
  percent-decode-then-bypass path; only open_external added to
  generate_handler!.

Both PASS → verified. Why queued: `Escalation: required` (react-markdown
dependency) — never auto-lands.

## Informational flags

1. Lockfile +1182 lines — all react-markdown transitives, no version changes
   to pre-existing packages, no new bin/install-script entries.
2. New process spawn in Rust (`/usr/bin/open`) — required by the criterion,
   gated behind the http(s) allowlist.
3. src/App.css +68 lines `.chat-text` markdown styling — supports the
   rendering criterion, not named in it.
4. package.json cosmetic reordering of @tauri-apps entries.
