# T6 check detail — release pipeline ships the bundle

Spec: docs/specs/2026-09-01-consumer-dmg.md
Branch: anchor/consumer-dmg-t6 (commits 5fde6df, d1a8ea7, d7a7134, 2550706;
5 files: docs/release.md, package.json, package-lock.json,
packaging/homebrew/stash.rb, scripts/release.sh)

## Verdicts

- Checker A (behavioral, fable): PASS — full fresh-clone proof: cloned the
  branch to scratchpad, `npm install` at root ONLY (postinstall pulled
  sidecar deps incl. the Agent SDK native binary), `npm run tauri build`
  exit 0, mounted DMG shows Contents/MacOS/{node,claude,stash} +
  Resources/sidecar/sidecar-bundle.mjs. dry-run exits 0 with the corrected
  plan; bash -n clean; typecheck clean; worktree clean.
- Checker B (audit, sonnet): PASS — no out-of-scope changes; postinstall is
  exactly `npm --prefix sidecar install` (verified verbatim, nothing
  chained); lockfile change is only the `hasInstallScript` metadata flag;
  release.sh signing rework is a strengthening (targeted inside-out signing
  with entitlements replaces `codesign --deep --force`; adds
  --verify --deep --strict + explicit JIT-entitlement assertions on app,
  node, claude, and the DMG's embedded copy; notarization/staple/sha256/gh
  release steps unchanged); stage-sidecar-runtime.sh untouched, checksum
  verification intact.

Both PASS → verified. Why queued: tripwire — package.json +
package-lock.json touched on a task not marked `Escalation: required`
(changes are the install-hook wiring the criteria demanded; no packages
added).

## Notes for the release operator

- A real signed/notarized release was not exercised (no signing env in this
  environment); the script self-checks entitlements at release time and
  fails loudly if they were stripped.
- The clean-machine GUI checklist in docs/release.md:115-137 is a manual
  gate by design — not executed by checkers.
