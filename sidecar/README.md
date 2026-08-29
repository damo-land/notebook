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
| `chat`   | `{ vaultDir, text, session?, turn? }` | `{ text, session }` — see [Chat](#chat) |

### Streaming lines

`chat` is the one method that writes to stdout before it answers. While the
model streams, it emits **unsolicited** lines:

```json
{"type": "chunk", "id": 3, "turn": "1", "text": "One note: "}
```

These are not responses: they carry no `ok`, they do not close the request,
and the normal `{id, ok, result}` line still follows. A reader must check
`type` **before** looking `id` up in its pending map — a chunk line carries
the request id too, so checking afterwards would hand the waiter its first
delta and close the request early. `turn` is the caller's own label for the
turn, echoed back so late chunks from a turn that already timed out are never
attributed to a newer one.

**Chunks are a preview; the response is the answer.** A chat turn gets several
round trips, and every assistant text delta of every one of them is emitted as
a chunk — including anything the model says before it reaches for Grep or Read
("I'll search the vault for that."). The `result` in the closing line is the
*final* assistant turn alone. So the chunks are a superset of the answer and
end with it; they equal it only when the model answered without narrating
first, which is its choice and not something either side controls. A client
rendering chunks live must therefore **overwrite** what it rendered with
`result` when the response line arrives — which is exactly what the chat view
does (`finishTurn` in `src/lib/chat-transcript.ts`). Treating the accumulated
chunks as the answer would leave a preamble stranded in front of it.

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

Chat adds five more passthroughs, all verified the same way against the
installed `sdk.d.ts`: `cwd` (`Options.cwd`, the root the filesystem tools work
from), `settingSources` (`Options.settingSources` — omitted means the CLI
loads user + project + local settings, `[]` is isolation mode), `resume` and
`persistSession` (`Options.resume` / `Options.persistSession` — a session can
only be resumed if the turn that created it persisted), and
`systemPromptAppend`, which becomes
`{ type: "preset", preset: "claude_code", append }`. The preset matters: a
bare `systemPrompt` string *replaces* the Claude Code prompt and would drop
the built-in tool instructions.

Two callbacks report progress without changing the call: `onText(delta)` fires
per streamed `text_delta` (turning on `Options.includePartialMessages`; only
text is forwarded, never tool-argument or thinking deltas), and
`onSessionId(id)` fires with the completed turn's `session_id`.

`onText` fires for every text delta of **every** permitted round trip, while
`runPrompt` returns the `result` message — the final assistant turn alone. The
deltas are therefore a superset of the return value and end with it, equal to
it only when the model answered in one turn. The return value is the
authority; see the [streaming lines](#streaming-lines) note above.

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
- **The write is a compare-and-swap, and it is atomic.** The model call can run
  for minutes, so the copy read at job start goes stale — the alerts scheduler
  (30s poll) or the user's own editor can write to the note inside that window,
  and a plain write of the stale copy would silently erase it. Immediately
  before replacing the file, enrichment re-reads it and compares the bytes
  against what it read at job start; if they differ it writes nothing at all
  and throws `EnrichConflictError`, so the concurrent write survives and the
  still-unmarked note is retried at next start. Otherwise the new content goes
  to a temp file **in the note's own directory** — `rename(2)` is only atomic
  within one filesystem, so a temp in `/tmp` would defeat the point — and is
  renamed over the target, so a reader never sees a half-written note. The temp
  is removed on the failure path too, and its name never ends in `.md` so the
  indexer cannot mistake it for a note. The conflict is thrown rather than
  returned, so it behaves like every other failure, but it is distinguishable:
  `instanceof EnrichConflictError` (or `err.code`) in process, and the stable
  `enrich conflict:` message prefix over the stdio protocol, which flattens
  errors to their message. The Rust worker does not yet split it out of its
  generic "job failed, note left untouched" log line.
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
model reply via `EnrichDeps.runPrompt`, and adds four scenarios a real reply
cannot pin down:

- the link cap clamping a 6-link reply down to 3;
- failure safety — a model error and an unusable reply each leave the note
  byte-identical with no marker;
- **the compare-and-swap**, driven from the `runPrompt` seam: the stub writes
  `alerted: true` into the note while the "model" is thinking (exactly what the
  alerts scheduler does mid-job) and the demo asserts that line is still there
  afterwards, that the job aborted with a conflict rather than a plain failure,
  that no `enriched` marker was written, and that no temp file was left behind.
  A second pass with nothing racing it then enriches normally, which is what
  stops the fix from quietly disabling enrichment;
- **the stdin guard**, against the real spawned server: `null`, `[1, 2, 3]` and
  `"just a string"` are all valid JSON but not requests. Each draws
  `{"id":null,"ok":false,"error":"request must be a JSON object"}` and a
  following `ping` still answers `pong` on the same process — a guard that
  read `.id` off the parsed value first would have died on the `null` line and
  taken every in-flight job with it.

`--real` swaps in the actual `runPrompt` and additionally asserts the appended
section summarises the fetched page.

## Chat

`src/chat.ts` implements the `chat` method: one turn of the overlay's `/chat`
view, answered by the SDK with the vault as its working directory so the reply
can cite real notes.

**Scoping.** The agent gets `cwd` = the vault, the tool set `Read`/`Glob`/
`Grep`, nothing in `additionalDirectories`, and `settingSources: []`. The tool
set is read-only by construction — no `Write`, `Edit`, `Bash` or `WebFetch` —
so the model cannot modify the vault or reach the network, and `[]` settings
stop a `CLAUDE.md` or `.claude/settings.json` that happens to be sitting in
the vault from steering the agent or widening its permissions (a notes
directory is user content, not a project). Note the limit: `cwd` sets the
default root, and absolute-path reads *outside* the vault have not been proven
blocked — the guarantee here is the read-only tool set plus a working
directory that contains only notes, not a filesystem sandbox.

**Continuity** is the SDK's own. The module is stateless: each turn carries
the previous turn's `session` id and gets one back (re-read every turn, not
assumed stable across a resume), so the conversation lives in the SDK session
under `~/.claude/projects/` — *outside* the vault. The human-readable
transcript is never persisted at all: it lives in the frontend's React state
for the length of the app session and dies with the process.

**No persona.** The only prompt customisation is `CHAT_SYSTEM_APPEND`, a
format-and-grounding instruction (search before answering, cite note ids, keep
it short). No name, no voice, no character, no "about the user" memory —
persona is a recorded v1 non-goal.

### Demo / proof

```
npm run sidecar:chat:demo              # stubbed — no model call, no spend
npm run sidecar:chat:demo -- --real    # one live call, cites a seeded note
```

Both seed a temp vault with a note carrying an invented keyword plus two
decoys and drive the same `chatTurn` / `chatPromptOptions` code, so the free
run is a genuine dry run of the paid one. Asserted on both paths: the vault
scoping above, the streaming contract below, that a turn yields only
`{text, session}` — the sidecar keeps no transcript — and that the vault is
byte-identical afterwards, recursively and including dotfiles.

**The streaming contract, in both shapes.** What streams depends on a choice
the model makes: it may answer directly (one assistant turn — the deltas then
happen to equal the answer), or it may narrate, search, and answer in a later
turn (the narration streams too, so the deltas exceed the answer). A proof
that only held in the first shape would pass or fail on the model's mood, so
the stubbed path drives *both* shapes at the `runPrompt` seam and asserts one
contract that holds in each: the returned text is the final assistant turn
alone, it arrived in multiple deltas, it is the **tail** of the stream, and
replaying the deltas through the chat view's own reducers
(`src/lib/chat-transcript.ts`) and then its `finishTurn` overwrite leaves the
user looking at exactly the returned text — narration and all discarded. The
narrate shape additionally asserts that the deltas do **not** equal the
answer, which is what stops the weaker equality claim creeping back in.
`--real` runs the same contract against a live turn (with the trailing-
whitespace boundary normalised, since nothing here controls whether the CLI
keeps a final newline on `result`) and prints which of the two shapes that
turn took.

The stubbed path additionally pins down what a live reply cannot: that the
first turn sends no `resume` and a later one resumes its id, that an empty
message is rejected before any model call, and — by spawning the real stdio
server with a deliberately invalid `chat` request — that the method is
dispatched and that a bad chat request leaves `ping` routing intact. `--real`
is the load-bearing version of the "nothing was written to the vault" check,
and the only path that shows the answer actually citing a note id.

The demo removes its temp vault but not the SDK session that `persistSession`
wrote for it, so a `--real` run leaves one directory behind under
`~/.claude/projects/-private-var-folders-…-notebook-chat-demo-XXXXXX/`. That
leftover is itself the evidence that sessions persist outside the vault;
delete it by hand when you are done with it.

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
