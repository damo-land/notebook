# Scout report: stash LLM providers — Ollama tool-calling feasibility (t1)

## Answers

### Q1: Is Ollama installed and reachable? Which models are pulled?
**Installed: yes. Daemon: up and reachable. Models pulled: none.**

Evidence (2026-08-31):
```
$ command -v ollama
/usr/local/bin/ollama
$ ollama --version
ollama version is 0.20.3
$ curl -s localhost:11434/api/tags
{"models":[]}
$ curl -s localhost:11434/api/version
{"version":"0.20.3"}
$ ollama list
NAME    ID    SIZE    MODIFIED        (empty — zero models)
```
The daemon was already running; no `ollama serve` was started (and nothing to kill).
Because pulling a model is a multi-GB install (outside this scout's read-only mandate),
Q2/Q3 could not be verified live. What the user must run first:

```
ollama pull qwen3:8b        # suggested default, ~5.2 GB, strong tool calling
ollama pull llama3.2:3b     # optional small comparison point, ~2 GB
```
Then: `node scripts/scratch/probe-tool-calls.mjs` and
`node scripts/scratch/probe-stream-tools.mjs qwen3:8b`.

### Q2: Does /api/chat tool calling work with an available local model?
**Unverified-live (no models pulled). Probe script written and runnable:**
`scripts/scratch/probe-tool-calls.mjs` (plain node, native fetch, no deps, Node v22.23.1
on this machine). It defines a `search_notes` tool (name/description/JSON-schema params
with required `query`), asks "What do my notes say about my sourdough starter?", asserts
`message.tool_calls` on turn 1, checks the call is well-formed (`function.name ===
"search_notes"`, object `arguments` with `query`), feeds a canned tool result back as a
`role: "tool"` message, and greps the ≥2nd assistant turn for facts only present in the
canned result ("Kevin", "1:2:2"). With no args it auto-probes every model in `/api/tags`;
it classifies failures as no-tool-call-with-answer (hallucination), empty reply, or
malformed call.

Evidence the script reaches the daemon correctly (fails only on missing model):
```
$ node scripts/scratch/probe-tool-calls.mjs
No models pulled. Run e.g.: ollama pull qwen3:8b        (exit 2)
$ node scripts/scratch/probe-tool-calls.mjs qwen3:8b
ERROR [qwen3:8b]: HTTP 404: {"error":"model 'qwen3:8b' not found"}
```
From Ollama API docs (unverified-live): `/api/chat` accepts a `tools` array of
`{type:"function", function:{name, description, parameters}}`; tool-capable models
(qwen3, llama3.1/3.2, mistral-nemo, etc.) return
`message.tool_calls: [{function:{name, arguments:{...}}}]` with `arguments` as a parsed
JSON object (no string-parsing needed, unlike OpenAI). Non-tool models return HTTP 400
`"does not support tools"` or silently answer in prose — the probe detects both.

### Q3: Does stream:true interleave sanely with tool calls?
**Unverified-live. Probe script written:** `scripts/scratch/probe-stream-tools.mjs` —
parses the NDJSON body line-by-line, prints every raw chunk for both turns, accumulates
`message.content` deltas and `message.tool_calls`, replays the tool result, and streams
the final answer. No live capture exists yet (no model); representative output cannot be
pasted — rerun after `ollama pull` and paste chunks into the spec.

From Ollama docs/release notes (unverified-live): since v0.8.0 (mid-2025) Ollama streams
tool calls; on 0.20.3 each NDJSON chunk is a full JSON object where a chunk carries
either a text delta (`"message":{"content":"..."}`) or complete parsed tool call(s)
(`"message":{"tool_calls":[...]}`), never partial JSON arguments split across chunks.
So text and tool-call deltas are separable by checking which key is present — the exact
invariant the probe asserts. Thinking-enabled models (qwen3) may also emit
`message.thinking` deltas before the tool call; the probe prints raw chunks so this
will be visible.

### Q4: Recommendation (tool loop vs RAG-lite primary, default model)
See Recommendation below.

## Also observed
- `scripts/scratch/` is gitignored (`.gitignore:19: scripts/scratch/`, confirmed via `git check-ignore -v`); both probes live there and nothing else was touched.
- Node v22.23.1 available, so native-fetch `.mjs` scripts need no `npx tsx`.
- Ollama 0.20.3 is recent (supports streaming tool calls and `thinking` field), so no upgrade is needed before probing.

## Recommendation
**Build RAG-lite as the guaranteed path, but architect the chat loop as a tool loop and
gate its enablement on the probe results — do not commit to tool-loop-primary until the
probes pass live.** Reasoning: the decisive evidence (Q2/Q3) is blocked on a model pull
the user must perform; RAG-lite (inject `search_notes` hits into the prompt, single
shot) works with *any* pulled model including non-tool ones, and degrades gracefully.
A tool loop implemented as "if model advertises tool support and probe-style handshake
succeeds, loop; else fall back to RAG-lite" costs little extra since both need the same
`search_notes`/`read_note` backends. Next step: user runs `ollama pull qwen3:8b`, then
both probe scripts; if qwen3:8b emits well-formed `tool_calls` and uses the fed-back
result (expected), promote tool loop to primary with RAG-lite fallback for non-tool
models.

**Suggested default model: `qwen3:8b`** (~5.2 GB) — best tool-calling reliability in the
small-model class as of mid-2026, comfortably runs on Apple Silicon, and handles the
multi-turn search→read→answer pattern; `llama3.2:3b` as the low-RAM alternative with
weaker tool adherence.

## Open decisions
- Whether to pull qwen3:8b (~5.2 GB disk/download) on this machine so the probes can run live — user action required.
- Acceptable latency budget for a multi-turn tool loop on local hardware (2–3 model round-trips per question) vs single-shot RAG-lite — needs user judgment after feeling real speeds.
