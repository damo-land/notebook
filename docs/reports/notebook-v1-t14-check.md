# Check report: notebook-v1 T14 — Chat mode (thin)

Date: 2026-08-29
Branch: anchor/notebook-v1-t14 (commits ecd7e9d, d9907a4, e654e2b, 38240f0, 920658f, 47ccc14)
Verdict round 1: **SPLIT** — audit **PASS** / behavioral **FAIL** → repair round (Repairs: 1)
**Verdict round 2 (after repair 933941d + 2411c2f): behavioral PASS / audit PASS — verified, queued at /anchor:land.**

## Round 2 — the repair and how hard it was tested

The repair took option (b): assert the invariant that is actually true. Its argument against (a) is
sound — a turn is only known to be final once it ends *without* a tool call, so streaming only the
final turn means either buffering the answer (killing the live streaming the checkers confirmed works)
or threading a discard signal through three files that were on the leave-alone list.

It also found the false claim was written in **four** places, not one (`llm.ts` docstring, `chat.ts`
docstring, two README sites). The audit checker grepped the tree for the old phrasing: zero remaining.

**Corrected, not weakened — the central question, answered by both lenses.** The old assertion was
`deltas.join("") === turn.text`, strict equality that is false whenever the model narrates. The new
contract is strictly *stronger*: the returned text is authoritative, the deltas are a superset with the
answer as the stream's tail, and replaying deltas through the view's own reducers plus its `finish()`
overwrite leaves exactly the returned text — asserted identically across two deterministically-driven
shapes. The narrate shape additionally asserts `stream !== turn.text`, which blocks the old false claim
from creeping back in.

**Mutation testing — 8 mutations against production code, all caught:**
- `finishTurn` keeps streamed text → exactly one failure, narrate shape only (reproduces the repair's
  own claim precisely)
- streaming flag not cleared → 2 failures; `appendDelta` drops deltas → 2; adds turns → 10;
  `chatTurn` stops forwarding `onText` → 6; drop `settingSources` → 1; widen tools with Write/Bash → 1;
  `cwd` not the vault → 1

**The decisive check**: injecting the OLD false assertion now yields `ok` in answer-directly and `FAIL`
in narrate-then-search **on every run**. The defect that previously depended on the model's mood is
caught deterministically.

**Live confirmation**: the checker's own paid run landed on narrate-then-search — the exact shape that
failed round 1 — and passed: 225 chars streamed in 5 deltas, 189-char answer, narration
"I'll search the vault for that term." ahead of it, and the **exact unnormalised tail match held**, so
the whitespace tolerance was not load-bearing. It named one honest boundary: an empty or
whitespace-only answer would make the tail check vacuous (`endsWith("")`), covered on the paid path by
the separate note-id citation assertions and on the stub path by exact matching.

**Extraction verified behaviour-preserving**: both reducer bodies moved character-identical;
`ChatTurn` re-exported; `src/App.tsx` untouched by either repair commit. The demo therefore tests the
shipped reducers, not a copy.

**No regression** to the two landed features sharing the sidecar: a bad `chat` request leaves ping
routing intact (asserted live), MCP and enrichment demos pass, and `llm.ts`'s new options are all
default-preserving. `cargo test` 7/7 across all four pre-existing test files.

## Round 1 detail (superseded, kept for history)

## Why it failed — a nondeterministic proof

The behavioral checker ran the paid path itself and the branch's own load-bearing proof command
**exited 1**:

```
FAIL: streamed deltas concatenate to exactly the final answer
chat-demo: 1 assertion(s) failed
REAL_EXIT=1
```

Cause is structural, in `sidecar/src/llm.ts`: `onText` forwards **every** `text_delta` across all 8
permitted turns, while `runPrompt` returns only `message.result` — the final result message.
Assistant text emitted *before* a Grep/Read tool call therefore streams into the transcript but is
absent from the returned answer, so the asserted invariant is simply not true in general.

It is **nondeterministic**, which is worse than plainly broken: the builder's run produced 2 deltas
and passed; the checker's produced 4 (the model narrated before searching) and failed. The same
command passes or fails depending on whether the model happens to speak before it searches.

The UI masks the underlying behaviour — `finish(reply.text)` overwrites the streamed text with the
authoritative answer — so the end state a user sees is correct. The defect is in the proof and in the
invariant it encodes, not in what lands on screen.

Note both checkers independently confirmed the *answer* half of the criterion first-hand: the
checker's own paid run returned "One note mentions it: `20260815-120000-zarbolyte-cache`…", citing the
seeded note. Streaming itself works — 4 deltas arrived over `chat-chunk`.

## Repair requirement

Make the proof true and deterministic. Either:
(a) stream only the final assistant turn's text, so deltas really do reconstruct the returned answer; or
(b) assert the invariant that is actually true — that the returned answer is authoritative and the
    streamed deltas are a superset — and cover the UI's overwrite behaviour explicitly.
Do NOT simply relax the assertion until it passes; state which option was taken and why, and prove the
chosen invariant holds across a run where the model both does and does not narrate before searching.

## Recorded evidence for the Proof criterion

The criterion reads: *"with ≥1 known note in vault, asking 'what notes mention <keyword>' yields an
answer referencing that note (manual step recorded in report; wiring verified by code)."* The audit
checker correctly noted it could not find that recorded run anywhere on disk — the builder's paid run
existed only in its hand-off report. Recording it here so the evidence is durable.

The demo seeded a temp vault with a note containing an **invented** word, so recall cannot explain the
answer — the content was obtainable only by reading the file:

```
One note: `20260815-120000-zarbolyte-cache` — the zarbolyte cache is flushed every 40 minutes by
the night job, and that flush window is the only safe time to rebuild its shard map.
```

Re-runnable as the opt-in paid path of `sidecar/scripts/chat-demo.ts` (default path is free).

## Criterion verdicts (audit lens)

- **Chat view**: `view === "chat"` branch mirrors the search precedent; transcript log + single input;
  Enter sends, Esc leaves with transcript intact, Ctrl+W hides. No pointer handlers — keyboard only.
- **Agent SDK session with vault readable, streaming**: `cwd: vaultDir`, `tools`/`allowedTools:
  ["Read","Glob","Grep"]`, `settingSources: []`, system append instructing it to Grep/Glob then Read and
  cite note ids. Streaming is wired end to end: `text_delta` → `onText` → unsolicited `{type:"chunk"}`
  lines → Tauri `chat-chunk` event → live append in the view. **The vault dir comes from Rust state
  (`index.vault_dir`), never from the frontend** — chat cannot be pointed elsewhere.
- **No persona**: `CHAT_SYSTEM_APPEND` is grounding/format only — no name, voice, or character. Role
  labels are plain "you"/"notebook". Non-goal recorded in code and README.
- **No vault writes**: chat module is stateless; transcript lives only in React state; grep confirms no
  write call in the chat path; the free demo asserts the vault is byte-identical recursively
  (dotfiles included) before and after a turn.
- **typecheck**: root 0, sidecar 0. `cargo check` clean, `cargo test` 7/7 pre-existing tests unmodified.

## Regression safety — the highest-risk part of this task

T14 touches the sidecar stdout reader and `llm.ts`, both shared with two landed features.

- **Chunk routing is ordered correctly**: lines are matched on `type` **before** the pending-id lookup.
  This matters because a chunk carries the same request id — the other order would hand the waiter its
  first delta and close the request early. Verified in `lib.rs`.
- **Malformed lines are safe**: JSON parse failure → no waiter matched → logged as an unmatched response.
  The reader thread cannot be killed, and ping/enrichment replies cannot be misrouted.
- **New options are inert for old callers**: the audit checker read the installed SDK source
  (`sdk.mjs`) and confirmed `cwd`, `settingSources` and `resume` fall back via `??`/truthiness when
  `undefined`, so passing them explicitly-undefined is equivalent to omitting them. `persistSession`
  still defaults false. `enrich.ts`'s narrower dependency type never supplies the new fields.

## Demo quality

21 substantive assertions against production code (stub replaces only `runPrompt`), including a real
stdio-server spawn proving dispatch with `ping` routing intact. It carries an explicit guard against
the `npm_config_real` flag-swallowing defect an earlier task in this project shipped, aborting loudly
rather than silently stubbing. Notably, the free path **labels its own vault-identity check as weak**
and points at `--real` as the load-bearing version rather than pretending to prove more than it does.

## Flags

1. **Prompt injection via note content is bounded by the tool set, not a sandbox.** The agent gets
   Read/Glob/Grep in a working directory containing only notes, with `settingSources: []` so a
   `CLAUDE.md` or `.claude/settings.json` dropped in the vault cannot steer it or widen permissions.
   But absolute-path reads outside the vault were **not proven blocked**. Self-disclosed in
   `sidecar/README.md`. Better than the standing unscoped-WebFetch precedent from T12; not equivalent
   to a filesystem jail.
2. **SDK session state is persisted under `~/.claude/projects/…`**, outside the vault, by design
   (`persistSession: true` enables real multi-turn `resume`). A `--real` demo run leaves a session
   directory in the user's home; the builder removed this session's two by hand and chose not to have
   a script delete things under `$HOME`.
3. Session `resume` acceptance by the SDK is unproven — the paid run was a single turn. The stub proves
   turn 2 sends turn 1's id.
4. Transcript scrollback is not keyboard-reachable (focus stays in the input). Criteria name only
   Enter/Esc/Ctrl+W, so not a violation; flagged rather than scope-crept.

## Deliberate divergence, judged justified

Transcript state lives in `App.tsx` rather than the view component — unlike the search and tasks views,
which deliberately remount and forget. The audit checker judged this necessary: "transcript kept for
session" cannot survive a component unmount otherwise. The view/palette state machine itself is
untouched.

## Unproven without launching the app

The chunk → `app.emit` → React `listen` hop, actual focus behaviour, live event ordering, and visual
rendering. Wiring is code-verified and compiles; the criterion explicitly permits a manual step here.
