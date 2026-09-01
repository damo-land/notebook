# Scout report: consumer-dmg T1 — sidecar packaging investigation

Read-only scout. No app code changed; prototype artifacts live in the gitignored
`scripts/scratch/` (`.gitignore:19` — `scripts/scratch/`): `sidecar-bundle.mjs`,
`drive.py`, `bundle-and-run.sh`. All runs below were on this machine
(macOS arm64, Darwin 24.6.0), 2026-09-01.

## Answers

### Q1: What does @anthropic-ai/claude-agent-sdk require at runtime?

**It does NOT spawn a bundled `cli.js` and does NOT need `node` on PATH.**
Version 0.3.250 ships the Claude Code CLI as a **native Mach-O executable** in a
platform-specific optional dependency, resolved via `require.resolve` relative
to `sdk.mjs`, and spawns it **directly** (no interpreter). It never uses
`process.execPath` (`grep -c "process.execPath" sdk.mjs` → `0`).

Evidence (all in `sidecar/node_modules/@anthropic-ai/claude-agent-sdk/`,
`sdk.mjs` is minified — 165 lines — so citations are line + verbatim snippet):

- **Native binary package.** `package.json` has
  `"optionalDependencies": { ... "@anthropic-ai/claude-agent-sdk-darwin-arm64": "0.3.250" ... }`
  and no `cli.js` in `"files"`. The installed
  `sidecar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude` is
  `Mach-O 64-bit executable arm64`, 206,479,552 bytes, already signed by
  Anthropic with hardened runtime:
  `Identifier=com.anthropic.claude-code ... flags=0x10000(runtime) ... TeamIdentifier=Q6L2SF6YDW`,
  entitlements include `com.apple.security.cs.allow-jit`,
  `com.apple.security.cs.allow-unsigned-executable-memory`,
  `com.apple.security.cs.disable-library-validation` (`codesign -d --entitlements -`).

- **Resolution logic** (`sdk.mjs` line 161, byte ~1448694):
  ```js
  let oE=u.pathToClaudeCodeExecutable;if(!oE){let dr=kXe(import.meta.url),to=AXe(dr),
  Yi=P2((yc)=>to.resolve(yc));if(!Yi)throw Error(`Native CLI binary for
  ${process.platform}-${process.arch} not found. Reinstall @anthropic-ai/claude-agent-sdk
  without --omit=optional, or set options.pathToClaudeCodeExecutable.`);oE=Yi}
  ```
  where `kXe = fileURLToPath` and `AXe = createRequire` (imports at sdk.mjs
  line 99, byte ~630919/631148). `P2` (line 99, byte ~914059) tries
  `require.resolve("@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude")`
  (with musl/exe-suffix variants). I.e. **default resolution is a node_modules
  lookup relative to wherever the sdk.mjs code physically lives** —
  after bundling, relative to the bundle file.

- **Direct spawn of the native binary** (line 99, byte ~905652):
  ```js
  let ht=CMe(a),ur=ht?a:o,Pt=ht?[...s,...Z]:[...s,a,...Z], ...
  this.process=this.spawnLocalProcess(se)
  ```
  with `function CMe(e){return![".js",".mjs",".tsx",".ts",".jsx"].some((n)=>e.endsWith(n))}`
  (line 99, byte ~912122): if the executable path is **not** a script, the
  command is the binary itself. `spawnLocalProcess` uses
  `import{spawn as bMe}from"child_process"` (line 99):
  `bMe(t,n,{cwd:r,stdio:["pipe","pipe","pipe"],signal:s,env:o,windowsHide:!0})`.
  Only if you point `pathToClaudeCodeExecutable` at a `.js/.mjs/...` file does it
  fall back to a JS runtime: `getDefaultExecutable(){return vc()?"bun":"node"}`
  (line 99; `vc()` = `process.versions.bun!==void 0`) — that bare `"node"`
  string is the only case needing node on PATH, and it is not the default path.

- **Options to override** (`sdk.d.ts`):
  - line 1815: `pathToClaudeCodeExecutable?: string;` ("Path to the Claude Code
    executable. Uses the built-in executable if not specified.")
  - line 1523: `executable?: 'bun' | 'deno' | 'node';` and line 1527:
    `executableArgs?: string[];` (only relevant when the executable is a script)
  - There is also `spawnClaudeCodeProcess` (custom spawn hook, seen in sdk.mjs).
  - **No env var** overrides the CLI path: `grep -o 'CLAUDE_[A-Z_]*EXEC...' sdk.mjs`
    finds only unrelated vars (`CLAUDE_AGENT_SDK_VERSION`, `CLAUDE_PTY_HOST_EXEC`, …).

- The sidecar's only SDK call site, `sidecar/src/llm.ts:161` (`query({...})`),
  does **not** pass `pathToClaudeCodeExecutable` — it relies on default
  resolution (grep across `sidecar/src/*.ts` for `pathToClaudeCodeExecutable`
  finds nothing).

Auth at runtime: OAuth creds come from the macOS **Keychain** item
`"Claude Code-credentials"` with account `$USER` (verified:
`security find-generic-password -s "Claude Code-credentials" -a "$USER"` hits;
`~/.claude/.credentials.json` does not exist here). See Q2c for the `USER` env
requirement this creates.

### Q2: Can the sidecar be bundled to one JS file and run by a standalone node with stripped PATH from a foreign cwd?

**Yes — proven end to end, including a real Agent SDK model call.**

Bundling (sidecar is ESM, `sidecar/package.json` `"type": "module"`):
```
cd sidecar && npx esbuild src/main.ts --bundle --platform=node --format=esm \
  --outfile=../scripts/scratch/sidecar-bundle.mjs
  ../scripts/scratch/sidecar-bundle.mjs  1.5mb
⚡ Done in 82ms
```
No externals, no banner hacks needed; `tsx` is compiled away (it is only the dev
loader). Actual size: 1,602,496 bytes.

The bundle was copied **outside the repo** to a scratchpad `appdir/`, and run by
absolute-path node with `env = {PATH: "/usr/bin:/bin", HOME, USER}` (no node,
npm, or homebrew dirs on PATH), cwd = an empty temp dir (`tempcwd/`), driven
over stdio by `scripts/scratch/drive.py`.

(a) **ping / stdio protocol** — works:
```
[stderr] [sidecar] started
[stdout] {"id":1,"ok":true,"result":"pong"}
```

(b) **ollama path** — works fully (the local ollama daemon happened to be up,
so this is a positive test, stronger than connection-refused):
```
[stdout] {"id":2,"ok":true,"result":{"reachable":true,"models":["qwen3:8b"]}}
[stdout] {"id":3,"ok":true,"result":"pong"}   <- prompt via {"llm":{"provider":"ollama","model":"qwen3:8b"}}
```
(`sidecar/src/ollama.ts:38` `OLLAMA_BASE_URL = "http://localhost:11434"`, plain
`fetch` at lines 426/503/572 — global fetch, no PATH dependency.)

(c) **Agent SDK call** — works, after staging the native binary. Three runs:

1. Bundle alone, no node_modules anywhere near it → the exact failure predicted
   by Q1's resolution logic:
   ```
   [stdout] {"id":4,"ok":false,"error":"Native CLI binary for darwin-arm64 not found.
   Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set
   options.pathToClaudeCodeExecutable."}
   ```
2. Staged `appdir/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/{claude,package.json}`
   next to the bundle, env `{PATH,HOME}` only → binary launches but auth fails:
   ```
   {"id":5,"ok":false,"error":"Not authenticated with Claude Code. LLM call failed:
   Failed to authenticate: OAuth session expired and could not be refreshed"}
   ```
   Bisected: full env works; minimal env + `USER` works; minimal env + `TMPDIR`
   fails. **`USER` is required** — it is the Keychain item's account name.
   Finder-launched apps always have `USER`, so this only bites artificial
   stripped-env harnesses, but T4 must not scrub `USER` from the child env.
3. Staged binary + `{PATH=/usr/bin:/bin, HOME, USER}` → **real model round trip**:
   ```
   [stdout] {"id":20,"ok":true,"result":"pong"}
   ```
   Since PATH contained no node at all and the call succeeded, this also
   empirically confirms Q1: the SDK spawned the native `claude` binary directly.

All of the above was repeated with a **freshly downloaded official
nodejs.org binary** (`node-v22.23.1-darwin-arm64/bin/node`, self-contained —
`otool -L` shows only `/System/...` and `/usr/lib/...` system libs) instead of
homebrew node:
```
[stdout] {"id":30,"ok":true,"result":"pong"}
[stdout] {"id":31,"ok":true,"result":{"reachable":true,"models":["qwen3:8b"]}}
[official-node+claude] {"id":32,"ok":true,"result":"pong"}
```
Repro: `scripts/scratch/bundle-and-run.sh` + `scripts/scratch/drive.py`.
Note: `sidecar/src/mcp.ts` (stdio MCP server) is a separate entrypoint not
imported by `main.ts` (main.ts imports only chat/enrich/llm/ollama/provider —
`sidecar/src/main.ts:23-33`); bundling `main.ts` alone covers the app runtime.

### Q3: Where should bundle + node live in the .app, and how does Rust resolve it packaged vs dev?

**Current state.** `src-tauri/tauri.conf.json` `bundle` has only
`"active": true, "targets": "all", "icon": [...]` — **no `resources`, no
`externalBin`**. The Rust side is dev-only wiring, broken by design for a
packaged consumer build:
- `src-tauri/src/lib.rs:1110-1112`: `fn sidecar_dir()` returns
  `Path::new(env!("CARGO_MANIFEST_DIR")).join("../sidecar")` — a compile-time
  path into the build machine's repo.
- `lib.rs:1114-1117`: `Command::new("node")` + `["--import","tsx","src/main.ts"]`
  — needs node on PATH; a Finder-launched app gets
  `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, so no node even if installed via brew.
- `Cargo.toml` has no `tauri-plugin-shell` (sidecar is spawned with
  `std::process::Command`), tauri = `"2"`.

**Tauri v2 mechanisms** (two options):

1. `bundle > resources` in `tauri.conf.json` — files copied into
   `stash.app/Contents/Resources/`. Rust resolves them via the path API on
   `tauri::Manager` (needs an `AppHandle`, which `spawn_sidecar()` currently
   doesn't take): `app.path().resource_dir()` or
   `app.path().resolve("relative/path", BaseDirectory::Resource)`. In `tauri dev`
   `resource_dir()` points at `src-tauri/target/debug/` (resources are copied
   there by the build), so one code path can serve both, or dev can keep the
   current `CARGO_MANIFEST_DIR` branch behind `#[cfg(debug_assertions)]`.
   Caveat: the bundler does **not** codesign arbitrary Mach-O files in
   Resources — see signing below.
2. `bundle > externalBin` (the Tauri "sidecar" mechanism) — binaries named with
   the target-triple suffix (e.g. `binaries/node-aarch64-apple-darwin`) are
   placed in `Contents/MacOS/` next to the main executable and are
   **codesigned by the Tauri bundler** with the same identity/entitlements as
   the app. Resolution: `tauri_plugin_shell`'s `.sidecar("node")`, or manually
   via the executable's own directory. `externalBin` does not require the shell
   plugin just to get the file bundled+signed; spawning can stay
   `std::process::Command` with a path derived from
   `std::env::current_exe()?.parent()` or `resource_dir()`.

**Proposed layout** (rationale in Q5):
- `Contents/MacOS/node` — via `externalBin` (gets signed correctly).
- `Contents/MacOS/claude` (or `Resources/sidecar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`
  if staying with default resolution) — prefer `externalBin` +
  `pathToClaudeCodeExecutable` so it is signed; see Q5.
- `Contents/Resources/sidecar/sidecar-bundle.mjs` — via `resources` (plain data
  file, no signing needed).

**Signing implications.** `scripts/release.sh` line ~121 does:
```
codesign --deep --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"
```
(after `npm run tauri build`, which already signs when
`APPLE_SIGNING_IDENTITY` is set — the script calls itself "belt-and-braces").
Implications of shipping node + claude inside the .app:
- Notarization requires **every** nested Mach-O to be signed with hardened
  runtime. `--deep --force` re-signs nested executables it finds but **strips
  their entitlements** (it applies no `--entitlements`, and entitlements are
  not preserved by default). Both binaries need
  `com.apple.security.cs.allow-jit` + `allow-unsigned-executable-memory` (V8
  and Bun/JSC JIT): nodejs.org's node ships signed with exactly those
  (verified: `flags=0x10000(runtime)`, entitlements dict includes both,
  `TeamIdentifier=HX7739G8FX` Node.js Foundation), and Anthropic's claude
  likewise (Q1). A blanket `--deep --force` re-sign would strip these and
  likely break both at runtime. T4 must either (a) sign the two binaries
  explicitly with an entitlements plist (what Tauri's bundler does for
  `externalBin` when `bundle > macOS > entitlements` is set) and drop/soften
  the `--deep --force` re-sign in release.sh, or (b) keep the vendors'
  original Developer ID signatures untouched (notarization accepts validly
  signed+hardened nested code from other teams) — which also rules out
  `--deep --force`.
- Executables under `Contents/Resources` are sealed as data by `codesign` and
  not per-file signed by the bundler; an unsigned-after-restage or
  entitlement-stripped binary there is the classic notarization rejection.
  Putting both executables through `externalBin` avoids the whole class.

### Q4: Size cost

Measured (bytes; gzip -6 as a DMG-compression proxy — Tauri DMGs are
compressed UDZO/zlib):

| artifact | raw | gzip -6 |
|---|---|---|
| sidecar-bundle.mjs (esbuild) | 1,602,496 (1.6 MB) | 400,022 (0.4 MB) |
| claude native binary (darwin-arm64, 0.3.250) | 206,479,552 (207 MB) | 83,939,486 (84 MB) |
| node v22.23.1 darwin-arm64 (official nodejs.org, self-contained) | 112,928,848 (113 MB) | 36,995,137 (37 MB) |
| **total added** | **~321 MB** | **~121 MB** |

Node proxy note: the machine's own node is homebrew
(`/opt/homebrew/Cellar/node@22/22.23.1/bin/node`, an 85 KB stub dynamically
linked against `libnode.127.dylib` (41.4 MB) plus ~10 homebrew dylibs — 56 MB
lib dir, **not shippable as-is**), so the official nodejs.org distribution
(downloaded to scratch, `content-length: 50067502` for the tar.gz) was measured
and used for the end-to-end test instead; only system libraries in `otool -L`.

Baseline today: `stash_0.1.0_aarch64.dmg` = 4,341,213 bytes (4.3 MB), app
13 MB. **Estimated DMG after packaging: ~125 MB (~30x); installed app
~334 MB.** The claude binary is 2/3 of it and is only needed for the claude
provider. For reference, current `sidecar/node_modules` is 277 MB — shipping
the bundle+binaries is already far smaller than shipping node_modules.

### Q5: Recommendation for T4

**Approach (single, concrete):**
1. **Build step** (in `beforeBuildCommand` or a script release.sh calls):
   `esbuild sidecar/src/main.ts --bundle --platform=node --format=esm
   --outfile=src-tauri/resources/sidecar/sidecar-bundle.mjs` (esbuild as a
   sidecar devDependency, not npx-at-build-time), plus stage
   `node` (official nodejs.org darwin-arm64 dist, pinned version + sha256) and
   `sidecar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`
   as `src-tauri/binaries/node-aarch64-apple-darwin` and
   `claude-aarch64-apple-darwin`.
2. **tauri.conf.json:** `bundle.externalBin: ["binaries/node", "binaries/claude"]`,
   `bundle.resources: ["resources/sidecar/sidecar-bundle.mjs"]`, and
   `bundle.macOS.entitlements` pointing at a plist with
   `com.apple.security.cs.allow-jit` and
   `com.apple.security.cs.allow-unsigned-executable-memory` so the bundler
   signs both executables usably. Remove (or make non-`--deep`) the
   belt-and-braces `codesign --deep --force` in `scripts/release.sh:~121`.
3. **Rust** (`spawn_sidecar`, lib.rs:1114): take an `AppHandle`; in release
   builds spawn `<Contents/MacOS>/node <resource_dir>/sidecar/sidecar-bundle.mjs`
   (paths via `current_exe().parent()` / `app.path().resource_dir()`),
   `current_dir` = a writable app-data dir, not the repo; keep the existing
   `node --import tsx src/main.ts` + `CARGO_MANIFEST_DIR` path under
   `#[cfg(debug_assertions)]`. Do not scrub `USER`/`HOME` from the child env
   (Keychain OAuth needs `USER`, proven in Q2c). Keep the existing
   `env_remove("ANTHROPIC_API_KEY")`.
4. **Sidecar:** pass the claude CLI path into the SDK. `llm.ts` currently
   omits `pathToClaudeCodeExecutable` (Q1); the cleanest self-contained wiring
   is an env var set by Rust (e.g. `STASH_CLAUDE_CLI=<Contents/MacOS>/claude`)
   that `llm.ts` forwards as `options.pathToClaudeCodeExecutable`. This avoids
   shipping a fake `node_modules` tree in Resources (which the Q2 prototype
   used only to prove the default-resolution mechanism).

**Fallback if the bundled claude binary cannot ship** (e.g. the ~84 MB
compressed hit or re-signing Anthropic's binary is unacceptable): ship only
node + bundle (~37 MB compressed DMG impact) and gate the claude provider on a
system Claude Code install — resolve `~/.local/bin/claude` /
`/opt/homebrew/bin/claude` / `~/.claude/local/claude` at runtime, pass it via
`pathToClaudeCodeExecutable` if found, else surface the existing
`claudeStatus`-style "not available" state and run **ollama-only** (the ollama
path is pure HTTP to localhost:11434 and was proven fully working from the
bundle). The sidecar's provider seam (`sidecar/src/provider.ts`, and
`claudeStatus`/`ollamaStatus` in `main.ts`) already models per-provider
availability, so the UI degradation path exists.

This is a recommendation, not authorization; implementation needs a promoted
ship task.

## Also observed
- `scripts/release.sh` computes VERSION/APP_NAME via `node -p` — the release
  script itself needs node on the *build* machine (fine) but would also fail on
  a PATH-stripped shell; unrelated to consumer machines.
- The dev spawn's `current_dir(sidecar_dir())` means SDK filesystem tools
  default to the repo sidecar dir as cwd (`RunPromptOptions.cwd` comment in
  llm.ts); the packaged cwd choice in T4 is user-visible to any tool-enabled
  prompt.
- `sidecar/node_modules` (277 MB) contains both the meta-package and the
  darwin-arm64 binary package; `npm ci --omit=optional` in CI would break the
  claude provider per the Q1 error message.
- The Agent SDK's `claude` binary embeds its own JS runtime (Bun-style,
  `extractFromBunfs` export in the SDK) — a future option is compiling the
  whole sidecar with `bun build --compile` to drop the separate node binary;
  untested here.

## Recommendation
See Q5. Next step: promote a ship task implementing (1)-(4), with a follow-up
release-flow task to swap `codesign --deep --force` for per-binary signing with
the JIT entitlements plist and to verify notarization of the nested node/claude
executables.

## Open decisions
- Ship the 207 MB (84 MB compressed) claude CLI inside the .app for a fully
  self-contained claude provider, vs. node-only (~37 MB compressed) with
  claude gated on a system Claude Code install (ollama always works). Pure
  size/product tradeoff — user call.
- Re-sign Anthropic's `claude` binary with the stash Developer ID (+JIT
  entitlements) vs. preserve Anthropic's original signature and hope
  notarization accepts foreign-team nested code (commonly accepted, not
  guaranteed by Apple docs). Affects release.sh design.
- Node major to pin for the shipped runtime (prototype used v22.23.1 LTS;
  SDK requires only `"node": ">=18.0.0"`).
