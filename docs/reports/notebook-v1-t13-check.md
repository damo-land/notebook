# Check report: notebook-v1 T13 — MCP server over vault

Date: 2026-08-28
Branch: anchor/notebook-v1-t13 (commits f6578e5, 672e33b, 2cdd115; repair f91ad2c)
Verdict round 1: SPLIT — behavioral PASS / audit FAIL → repair round (Repairs: 1)
**Verdict round 2 (after repair): behavioral PASS / audit PASS — verified, queued at /anchor:land (tripwire).**

## Round 2 — repair and re-verification

Fix (README only, no code): documented command now uses an absolute tsx loader path —
`claude mcp add notebook -- node --import /ABS/PATH/sidecar/node_modules/tsx/dist/loader.mjs /ABS/PATH/sidecar/src/mcp.ts`
with the `sidecar:install` prerequisite stated (command reaches into node_modules).

Builder REJECTED the `npm --prefix` option I suggested, with evidence: `npm run` prints its
banner to **stdout**, which is the JSON-RPC channel — it would corrupt the protocol. Both
round-2 checkers independently reproduced this (4 non-JSON lines ahead of the reply). Recorded
in the README so it is not reintroduced.

Round-2 evidence:
- Behavioral: parsed the command out of the README, substituted the path, spawned it across
  3 cwds (worktree root, /Users/damo, /tmp) x 2 vault configs = 6 full handshakes
  (initialize -> tools/list -> tools/call). All returned valid JSON-RPC, zero stdout pollution,
  real vault content. Read-only re-proven by sha256+mtime+size snapshot of a 14-note vault.
  Escapes rejected incl. sibling-prefix `<vault>-evil/secret.md`; list_recent bounds enforced
  (n=0, n=101, n=2.5 all rejected -32602); done:true excluded from list_tasks.
- Audit: reproduced the OLD failure (bare specifier from /tmp -> ERR_MODULE_NOT_FOUND) and the
  fix working; clamp byte-identical to app's; lockfile delta still zero new packages.

Round-2 flags (informational):
1. `sidecar/scripts/mcp-demo.ts` still spawns the narrower pinned invocation (`--import tsx`,
   relative path, cwd=sidecar/) — this asymmetry is exactly what let the broken command ship in
   round 1. Consider aligning the demo with the documented command in a later task.
2. Root `npm run typecheck` does not cover sidecar/; criterion met via two commands.
3. Path clamp is pure string normalization (no realpath) — a symlink inside the vault pointing
   outward would be followed. Out of scope for stated criteria; note for hardening.
4. Root package.json also gained `sidecar:mcp` (convenience alias, no criterion) — README warns
   against registering it as the MCP command.

## Round 1 detail (superseded, kept for history)

## Failing criterion (audit)

**"Registration documented in README: exact `claude mcp add` command; running it makes tools callable from Claude Code" — FAIL.**

Evidence: documented command is
`claude mcp add notebook -- node --import tsx /ABSOLUTE/PATH/TO/REPO/sidecar/src/mcp.ts`.
Audit reproduced the underlying spawn:
- from repo root (where README says to run `pwd`): `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from <repo-root>/` — exit 1
- from unrelated cwd (`/Users/damo`): identical failure
- works ONLY with cwd=sidecar/ (which the README never states for the MCP command; its own lifecycle section shows the author knows cwd matters).

Root cause: `--import tsx` is a bare specifier resolved against process cwd; root package has no tsx. Claude Code spawns MCP servers from arbitrary cwd → registration fails as documented.

## Repair requirement

Make the registration command cwd-independent AND documented exactly. Candidate fixes (builder's choice):
- `claude mcp add notebook -- npm --prefix /ABSOLUTE/PATH/TO/REPO/sidecar run mcp` (npm --prefix pins cwd)
- or `node --import /ABSOLUTE/PATH/TO/REPO/sidecar/node_modules/tsx/dist/loader.mjs ...` style absolute import
- or a plain-JS build output invoked directly.
Must be verified by actually spawning the documented command line (minus `claude mcp add` wrapper) from repo root AND an unrelated cwd — both must start the server.

## Passing findings (round 1, both checkers)

- 4 read-only tools live-verified; byte-identical clamp to app's notePath; escapes rejected (../, absolute outside, prefix); done:true excluded; n bounds enforced; read-only proven via mtime+content comparison.
- Demo handshake green (search_notes returns matching snippet). Root+sidecar typecheck 0.
- Lockfile delta: ZERO new node_modules entries (SDK+zod already present as claude-agent-sdk transitives; only peer→direct promotion). No hooks, registry-only.
- tsconfig include widened (adds scripts/) — coverage expansion, not tampering.
