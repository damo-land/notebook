# T4 check detail — bundle sidecar into the .app

Spec: docs/specs/2026-09-01-consumer-dmg.md
Branch: anchor/consumer-dmg-t4 (commits 5bb863b, 9ef9867; 10 files:
.gitignore, package.json, scripts/stage-sidecar-runtime.sh,
sidecar/package{,-lock}.json, sidecar/src/llm.ts, src-tauri/build.rs,
src-tauri/entitlements.plist, src-tauri/src/lib.rs, src-tauri/tauri.conf.json)

## Verdicts

- Checker A (behavioral, fable): PASS — .app contains Contents/MacOS/{node
  (112 MB), claude (206 MB)} + Resources/sidecar/sidecar-bundle.mjs; strings
  scan of release binary shows no repo paths; stripped-env run (env -i
  PATH=/usr/bin:/bin, foreign cwd): ping pong, ollama real round trip
  ("hello"), claudeStatus authenticated:true through the shipped claude with
  a negative control (unset STASH_CLAUDE_CLI → "Native CLI binary ... not
  found") proving provenance; cargo test + typecheck green; worktree clean.
  Caveat: spawn-failure non-fatality verified from code structure, not a
  live sabotaged-spawn GUI launch.
- Checker B (audit, sonnet): PASS — no out-of-scope changes; dev spawn path
  compiles out of release via cfg(debug_assertions); ANTHROPIC_API_KEY
  stripping preserved on both paths (lib.rs:1180).

Both PASS → verified. Task is `Escalation: required` (pre-authorized: esbuild
devDependency + shipped node/claude binaries) → never auto-lands; queued at
/anchor:land.

## Flags (informational)

1. stage-sidecar-runtime.sh downloads node v22.23.1 from https://nodejs.org
   only, sha256-checked against SHASUMS256.txt fetched from the same host,
   exit 1 + tarball deletion on mismatch; no other fetch or fetch-and-execute.
2. entitlements.plist adds exactly `com.apple.security.cs.allow-jit` and
   `com.apple.security.cs.allow-unsigned-executable-memory` (needed for
   embedded JS runtimes under hardened runtime); no sandbox- or
   library-validation-disabling entitlements introduced (broader ones seen
   on the vendored binaries are Anthropic's/Node's own signatures).
3. esbuild@0.28.2 devDependency in sidecar/package.json (pre-authorized);
   lockfile diff minimal (already transitive via tsx). node/claude staged
   under gitignored src-tauri/{binaries,resources}/ — confirmed absent from
   git ls-files.
4. Code comments cite docs/reports/consumer-dmg-t1-packaging.md, which is
   uncommitted anchor state on main (by design — anchor never commits
   reports); checker flagged it as a provenance gap since it's invisible
   from the branch. Resolves once the user commits the report.

## Builder notes carried forward

- DMG now 125,457,336 bytes (~125 MB) vs 4.3 MB baseline — matches T1
  estimate.
- scripts/release.sh `codesign --deep --force` left untouched per T1 scoping:
  a signed+notarized release still needs the T6 follow-up (the blanket
  re-sign would strip the JIT entitlements Tauri applies).
- src-tauri/build.rs creates empty debug-only externalBin placeholders so
  bare `cargo test` / `tauri dev` work on a fresh clone; release builds fail
  loudly without staging.
