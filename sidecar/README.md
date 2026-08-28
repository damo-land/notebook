# notebook-sidecar

Node process that gives the notebook app access to Claude via the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk). Self-contained
npm package: own dependencies, own lockfile, own tsconfig — the root npm tree
is untouched apart from the `sidecar:*` script aliases.

## Process lifecycle

The Tauri app spawns the sidecar on startup (`src-tauri/src/lib.rs`):

```
node --import tsx src/main.ts   (cwd: sidecar/)
```

The child handle lives in Tauri managed state and is killed on `RunEvent::Exit`
(app quit). No restart logic in v1. If the spawn fails, the app keeps running
without agent features. Dev wiring: the sidecar directory is resolved relative
to `CARGO_MANIFEST_DIR` (i.e. the repo checkout) and `node` must be on the
app's PATH — fine when launched via `npm run tauri dev`; a bundled-app story
comes later.

Run `npm run sidecar:install` (from the repo root) once before first launch.

## Protocol

Line-delimited JSON over stdio. One request per line on stdin, one response
per line on stdout. Logs go to stderr, never stdout.

Request:

```json
{"id": 1, "method": "ping"}
{"id": 2, "method": "prompt", "params": {"text": "Summarize: ..."}}
```

Response:

```json
{"id": 1, "ok": true, "result": "pong"}
{"id": 2, "ok": false, "error": "Not authenticated with Claude Code. ..."}
```

- `id` is echoed back verbatim (`null` if the request line was unparseable).
- `ok: true` carries `result`; `ok: false` carries `error` (string).
- The sidecar exits when its stdin closes.

### Methods (v1)

| method   | params             | result                  |
| -------- | ------------------ | ----------------------- |
| `ping`   | —                  | `"pong"` (no LLM call)  |
| `prompt` | `{ text: string }` | model response as text  |
| `enrich` | `{ vaultDir, path, related? }` | `EnrichResult` — see [Enrichment](#enrichment) |

Later tasks (chat) add methods; the framing stays the same.

Responses are routed back **by request id**: the Rust side keeps a map of
in-flight ids and a single stdout reader thread hands each response line to
whichever caller asked for that id. A minutes-long `enrich` job and a
`sidecar_ping` from the UI therefore run concurrently without stealing each
other's replies.

The Rust side exposes a `sidecar_ping` Tauri command that proves the
round trip (writes a ping line, waits up to 10s for the response line).

## Model calls

All LLM access goes through `src/llm.ts` — the only file that imports
`@anthropic-ai/claude-agent-sdk` at runtime, so the provider is swappable.
`runPrompt(text)` wraps the SDK's `query()` as a single-shot call (no tools,
one turn) by default. Model selection: `NOTEBOOK_MODEL` env var if set,
otherwise the SDK default.

`runPrompt(text, opts)` also takes `tools`, `allowedTools` and `maxTurns`,
which is how enrichment gets web access. Both tool options are needed: `tools`
makes the built-in tool available, and `allowedTools` auto-approves it —
without it the tool falls through to `permissionMode` and asks for a permission
that nothing can answer in a background process. `maxTurns` must be > 1 for a
tool round trip. (Option shape verified against `Options.tools` /
`Options.allowedTools` in the installed SDK's `sdk.d.ts` and the Agent SDK
TypeScript reference, not from memory.)

## Enrichment

`src/enrich.ts` implements the `enrich` method: a background pass over one
`kind: knowledge` note. It is triggered by the Rust vault watcher, not by the
capture UI — the file is always on disk before a job starts, so capture latency
is untouched, and it fires whatever wrote the note (overlay, editor, MCP, or
your own text editor). See `src-tauri/src/enrich.rs` for job selection.

**Append-only contract.** The note's existing body is read once and re-emitted
byte-for-byte. The only permitted additions are:

1. the frontmatter fields `tags`, `source` and `enriched`,
2. one `## Context` section appended after the existing body,
3. `[[wiki-links]]` to existing notes, inside that appended section.

Nothing rewrites, reorders or reflows user text. Supporting rules:

- **Tags merge**, never replace — existing tags keep their order and position,
  and new ones are sanitised (a tag containing a comma would still parse but
  would silently split into two).
- **Links are clamped deterministically**, not trusted to the model: targets
  outside the candidate ids the Rust side supplied are de-linked to plain text
  (so a hallucinated target never becomes a dangling link), then the first 3
  distinct targets survive.
- **`source` is the note's own first URL**, never model-supplied — a bookmark's
  source has to be verifiable.
- **Every failure throws before the write.** A note whose enrichment fails is
  left exactly as the user saved it, *and* without an `enriched` marker, which
  is what makes the app's next start retry it.
- **`enriched` is the idempotence marker.** It lives in the vault file rather
  than an index column, so it survives a db wipe. A note that carries it is
  skipped without a model call.

`params.related` is a list of `{ id, title }` candidate link targets. The Rust
side picks them from the SQLite FTS index and passes them in, so the sidecar
never needs database access.

### Demo / proof

```
npm run sidecar:enrich:demo              # stubbed — no model call, no spend
npm run sidecar:enrich:demo -- --real    # one live call (WebFetch/bookmark)
```

Both seed a temp vault with a knowledge note containing a public URL plus two
unrelated notes, enrich it, print the resulting note, and assert: the original
body bytes are present verbatim (byte comparison against the pre-enrichment
body), an appended `## Context` section exists, `enriched` is set and parses as
a date, at most 3 `[[wiki-links]]` and all to notes that exist, and the file
still parses under **both** the TS parser and a mirror of the Rust parser's
rules (`sidecar/scripts/enrich-demo.ts`).

The stubbed run is the default on purpose: the invariants above can be
re-verified by anyone, any time, without spending a prompt. It injects the
model reply via `EnrichDeps.runPrompt`, and adds two scenarios a real reply
cannot pin down — the link cap clamping a 6-link reply down to 3, and failure
safety (a model error and an unusable reply each leave the note byte-identical
with no marker). `--real` swaps in the actual `runPrompt` and additionally
asserts the appended section summarises the fetched page.

## Auth

Auth relies on the Claude Code OAuth credential chain (your Claude
subscription) — the same login the `claude` CLI uses. Set it up once:

```
claude setup-token
```

(or just be logged in to Claude Code).

`ANTHROPIC_API_KEY` is **never** used: the Tauri process strips it before
spawning the sidecar, and `llm.ts` deletes it from the environment (with a
stderr warning) before calling the SDK, so billing always stays on the
subscription.

## MCP server

`src/mcp.ts` is a separate entry point: a stdio [MCP](https://modelcontextprotocol.io)
server exposing the notebook vault to MCP clients such as Claude Code.
Read-only in v1 — it never writes to the vault.

Vault dir resolution matches the app: `NOTEBOOK_VAULT_DIR` env override (used
by tests), else `~/.config/notebook/config.json` `vaultDir`, else `~/Notebook`.
It reads the markdown files directly (no SQLite index involved).

### Tools

| tool           | args                  | returns                                                        |
| -------------- | --------------------- | -------------------------------------------------------------- |
| `search_notes` | `{ query }`           | case-insensitive substring match over body/title/tags; matches with id, title, kind, snippet |
| `read_note`    | `{ id_or_path }`      | frontmatter + full body; paths outside the vault are rejected  |
| `list_tasks`   | —                     | open tasks (`kind: task`, not done), deadline asc, no-deadline last |
| `list_recent`  | `{ n }` (default 10)  | n most recent notes by `created`, newest first                 |

### Registering with Claude Code

Run `npm run sidecar:install` first — the command below points straight into
`sidecar/node_modules/`, so the dependencies have to be installed already.

```
claude mcp add notebook -- node --import /ABSOLUTE/PATH/TO/REPO/sidecar/node_modules/tsx/dist/loader.mjs /ABSOLUTE/PATH/TO/REPO/sidecar/src/mcp.ts
```

Replace `/ABSOLUTE/PATH/TO/REPO` in **both** places with your checkout path
(the output of `pwd` at the repo root). Both are absolute on purpose: Claude
Code spawns MCP servers from an arbitrary working directory, so a bare
`--import tsx` specifier would be resolved against that directory and fail
with `ERR_MODULE_NOT_FOUND`.

For the same reason, do not register `npm run sidecar:mcp` (or
`npm --prefix … run mcp`) as the server command. That script is a manual
convenience only — npm prints its `> notebook-sidecar@0.1.0 mcp` banner to
stdout, which is the JSON-RPC channel, and corrupts the stream.

After adding, verify with `claude mcp list`. The tools are then callable from
Claude Code as `mcp__notebook__search_notes`, `mcp__notebook__read_note`,
`mcp__notebook__list_tasks` and `mcp__notebook__list_recent`.

### Demo / proof

```
npm run sidecar:mcp:demo
```

Spawns the MCP server against a temp vault (`NOTEBOOK_VAULT_DIR`), performs
the MCP handshake with the SDK client, calls all four tools and asserts the
matching note content comes back (`sidecar/scripts/mcp-demo.ts`). Exits 0 on
success.

## Smoke test

From the repo root:

```
npm run sidecar:smoke
```

Sends one trivial prompt. Prints the response and exits 0 when authed; prints
`Not authenticated. Run: claude setup-token` and exits 1 when not.
