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

## Smoke test

From the repo root:

```
npm run sidecar:smoke
```

Sends one trivial prompt. Prints the response and exits 0 when authed; prints
`Not authenticated. Run: claude setup-token` and exits 1 when not.
