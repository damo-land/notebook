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

Later tasks (enrichment, chat) add methods; the framing stays the same.

The Rust side exposes a `sidecar_ping` Tauri command that proves the
round trip (writes a ping line, waits up to 10s for the response line).

## Model calls

All LLM access goes through `src/llm.ts` — the only file that imports
`@anthropic-ai/claude-agent-sdk` at runtime, so the provider is swappable.
`runPrompt(text)` wraps the SDK's `query()` as a single-shot call (no tools,
one turn). Model selection: `NOTEBOOK_MODEL` env var if set, otherwise the
SDK default.

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

```
claude mcp add notebook -- node --import tsx /ABSOLUTE/PATH/TO/REPO/sidecar/src/mcp.ts
```

Replace `/ABSOLUTE/PATH/TO/REPO` with your checkout path (e.g. the output of
`pwd` at the repo root). Run `npm run sidecar:install` first so `tsx` and the
MCP SDK are present. After adding, the tools are callable from Claude Code as
`mcp__notebook__search_notes` etc.; verify with `claude mcp list`.

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
