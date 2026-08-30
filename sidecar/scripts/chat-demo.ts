// Proof script for chat mode (T14).
//
// Seeds a temp vault with a note carrying a distinctive keyword plus two
// decoys, then drives the chat path over it and asserts the acceptance
// criteria that have a mechanical proof:
//
//   * the SDK options a chat turn runs with are scoped to the vault —
//     cwd is the vault, the tool set is read-only (Read/Glob/Grep, no Write,
//     Edit, Bash or WebFetch), nothing widens it with additionalDirectories,
//     and settingSources is [] so a CLAUDE.md or .claude/settings.json in the
//     vault cannot steer the agent or widen its permissions;
//   * responses STREAM, and the streaming contract holds in BOTH of the shapes
//     a multi-turn chat can take (see "two shapes" below): the returned text is
//     the final assistant turn alone and is authoritative, the deltas are every
//     assistant text delta of the turn and so are a superset of it, the
//     returned text is the tail of the stream, and the view's finish()
//     overwrite leaves the user looking at exactly the returned text;
//   * session continuity is real: turn 1 sends no `resume`, turn 2 sends the
//     session id turn 1 came back with, and the id is re-read from every turn
//     rather than assumed stable;
//   * the sidecar keeps NO transcript — a turn's result is {text, session}
//     and nothing else;
//   * the chat transcript is not written to the vault (nor is anything else):
//     the vault is byte-identical, recursively and including dotfiles,
//     before and after;
//   * the real sidecar server dispatches `chat` and survives a bad chat
//     request without dropping its other routing.
//
// Run (stubbed — no model call, no spend; this is the default):
//     npm run sidecar:chat:demo
// Run against the real LLM (ONE paid prompt; proves the answer actually
// cites a note from the vault, and that a live run writes nothing into it):
//     npm run sidecar:chat:demo -- --real
//
// Both paths go through the same `chatTurn` / `chatPromptOptions` code with
// the same assertions, so the free path is a genuine dry run of the paid one.
//
// --- two shapes -------------------------------------------------------------
//
// A chat turn is allowed 8 round trips, and what streams out of it depends on
// a choice the model makes, not on anything this code controls:
//
//   answer-directly     the model answers in one assistant turn.
//                       stream === returned text.
//   narrate-then-search the model says something ("I'll search the vault for
//                       that."), calls Grep/Read, and answers in a later turn.
//                       Those first words stream too, but the returned text is
//                       the final turn alone: stream !== returned text.
//
// A proof that only holds in one of those shapes is not a proof — it passes or
// fails on the model's mood. So the free path drives BOTH shapes with stubbed
// replies, at the `runPrompt` seam where the superset behaviour originates,
// and asserts one contract that holds in both. `--real` then confirms a live
// SDK turn is one of the two shapes and satisfies the same contract.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_SYSTEM_APPEND,
  CHAT_TOOLS,
  chatDeps,
  chatPromptOptions,
  chatTurn,
  type ChatDeps,
  type ChatTurnResult,
} from "../src/chat.ts";
import type { RunPromptOptions } from "../src/llm.ts";
// The frontend's two transcript reducers — the same functions the chat view
// calls — so the proof can carry a turn all the way through to what the user
// is finally left looking at. Pure TS, no React, no DOM.
import {
  appendDelta,
  finishTurn,
  type ChatTurn,
} from "../../src/lib/chat-transcript.ts";

const real = process.argv.includes("--real");

// A stub must never be able to masquerade as a real run. `npm run <script>
// --real` (and the same thing via an npm alias that forgets to pass `--`)
// silently swallows the flag as an npm config and exports it as
// `npm_config_real` instead of delivering it to argv.
if (!real && process.env["npm_config_real"] !== undefined) {
  console.error(
    "FATAL: `--real` was requested but npm swallowed it as a config flag, so " +
      "this run would have been STUBBED while looking real.\n" +
      "Use one of:\n" +
      "  npm run sidecar:chat:demo -- --real\n" +
      "  npm --prefix sidecar run chat:demo -- --real\n" +
      "  npx tsx sidecar/scripts/chat-demo.ts --real",
  );
  process.exit(1);
}

const sidecarDir = fileURLToPath(new URL("..", import.meta.url));

let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
    return;
  }
  console.log(`ok: ${msg}`);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- vault snapshot ----------------------------------------------------------

/**
 * Recursive content fingerprint of a directory: every path (dotfiles and
 * directories included) with a sha256 of each file. Any write, anywhere
 * underneath, changes this string.
 */
async function snapshotVault(dir: string): Promise<string> {
  const lines: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    const entries = await readdir(join(dir, rel), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        lines.push(`dir  ${child}`);
        await walk(child);
      } else {
        const hash = createHash("sha256")
          .update(await readFile(join(dir, child)))
          .digest("hex");
        lines.push(`file ${child} ${hash}`);
      }
    }
  };
  await walk("");
  return lines.join("\n");
}

// --- the seeded vault --------------------------------------------------------

/** Invented token: no model can answer this from memory, only by reading. */
const KEYWORD = "zarbolyte";
const TARGET_ID = "20260815-120000-zarbolyte-cache";

async function seedVault(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "stash-chat-demo-"));
  await writeFile(
    join(dir, `${TARGET_ID}.md`),
    `---
id: ${TARGET_ID}
created: 2026-08-15T12:00:00.000Z
kind: knowledge
tags: [infra]
---
Zarbolyte cache

The ${KEYWORD} cache is flushed every 40 minutes by the night job, and the
flush window is the only time its shard map can be rebuilt safely.
`,
  );
  await writeFile(
    join(dir, "20260801-101500-groceries.md"),
    `---
id: 20260801-101500-groceries
created: 2026-08-01T10:15:00.000Z
kind: note
tags: [shopping]
---
Groceries list

Buy oat milk and rye bread.
`,
  );
  await writeFile(
    join(dir, "20260810-090000-file-taxes.md"),
    `---
id: 20260810-090000-file-taxes
created: 2026-08-10T09:00:00.000Z
kind: task
tags: [admin]
deadline: 2026-09-15
done: false
---
File taxes

Gather receipts first.
`,
  );
  return dir;
}

// --- stub deps ---------------------------------------------------------------

interface Capture {
  text: string;
  opts: RunPromptOptions;
}

/** Split a reply the way the SDK streams one: many small text deltas. */
function deltasOf(reply: string): string[] {
  return reply.match(/.{1,7}/gs) ?? [reply];
}

/** One of the two shapes a chat turn can take. See the header. */
interface Shape {
  name: string;
  /**
   * Assistant text emitted BEFORE the model calls a tool, ending that turn.
   * Empty for answer-directly. It streams, and it is not part of the answer.
   */
  narration: string;
  /** The final assistant turn: the string `runPrompt` returns. */
  answer: string;
}

/**
 * Stands in for the SDK at the `runPrompt` seam. Records the options it was
 * handed and fires the same callbacks the real `runPrompt` fires, in the same
 * order — but with the narration/answer split made deterministic instead of
 * left to the model. In particular it streams the narration through `onText`
 * and then does NOT return it, which is exactly what the SDK does when the
 * model speaks before it searches.
 */
function stubDeps(shape: Shape, sessionId: string, captured: Capture[]): ChatDeps {
  return {
    runPrompt: async (text, opts = {}) => {
      captured.push({ text, opts });
      if (shape.narration !== "") {
        for (const delta of deltasOf(shape.narration)) opts.onText?.(delta);
        // …and the tool call that ends that turn, so the stub's shape matches
        // the SDK's even though chat never asks for onToolUse.
        opts.onToolUse?.("Grep", { pattern: KEYWORD });
      }
      for (const delta of deltasOf(shape.answer)) opts.onText?.(delta);
      opts.onSessionId?.(sessionId);
      return shape.answer;
    },
  };
}

// --- one turn, shared by both paths ------------------------------------------

interface Asked extends ChatTurnResult {
  deltas: string[];
}

async function ask(
  vaultDir: string,
  question: string,
  deps: ChatDeps,
  session?: string,
): Promise<Asked> {
  const deltas: string[] = [];
  const result = await chatTurn(
    { vaultDir, text: question, ...(session === undefined ? {} : { session }) },
    deps,
    { onText: (delta) => deltas.push(delta) },
  );
  return { ...result, deltas };
}

// --- scoping assertions, run against whatever options a turn actually used ----

const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "StashEdit", "Bash", "WebFetch", "WebSearch"];

function assertScoping(opts: RunPromptOptions, vaultDir: string): void {
  assert(opts.cwd === vaultDir, "session cwd is the vault dir");
  assert(same(opts.tools, CHAT_TOOLS), `tools restricted to ${CHAT_TOOLS.join("/")}`);
  assert(same(opts.allowedTools, CHAT_TOOLS), "allowedTools matches tools (nothing stalls on a prompt)");
  const offered = [...(opts.tools ?? []), ...(opts.allowedTools ?? [])];
  assert(
    WRITE_TOOLS.every((t) => !offered.includes(t)),
    "no write-capable or network tool is offered (Write/Edit/Bash/WebFetch/…)",
  );
  assert(
    !("additionalDirectories" in opts),
    "no additionalDirectories widens the session beyond the vault",
  );
  assert(same(opts.settingSources, []), "settingSources is [] (no CLAUDE.md / settings from the vault)");
  assert((opts.maxTurns ?? 1) > 1, "maxTurns > 1, so a Grep+Read round trip can finish");
  assert(opts.persistSession === true, "persistSession true, so the next turn can resume this session");
}

// --- the streaming contract, asserted identically in both shapes -------------

/**
 * What is actually true of a streamed turn, and all that is true of one:
 *
 *   1. the returned text is the final assistant turn alone — narration never
 *      contaminates it;
 *   2. it arrived in pieces, not as one blob;
 *   3. every character of it was streamed, in order, as the TAIL of the
 *      stream — so a live renderer really did show the answer being written,
 *      and the stream is a superset of the answer, never a subset of it.
 *
 * `exact` is false only on the `--real` path, where the boundary is compared
 * with trailing whitespace normalised: the claim tested is the same one, but
 * we do not control whether the CLI preserves a trailing newline on `result`,
 * and a whitespace byte must not be able to decide a paid run. On the stubbed
 * path the strings are ours, so the comparison is character-for-character.
 */
function assertStreamContract(
  turn: Asked,
  /** The final assistant turn, when it is known independently (stubbed only). */
  answer: string | null,
  tag: string,
  exact: boolean,
): void {
  const stream = turn.deltas.join("");
  if (answer !== null) {
    assert(turn.text === answer, `[${tag}] the returned text is the final assistant turn alone`);
  }
  assert(turn.deltas.length > 1, `[${tag}] answer streamed in ${turn.deltas.length} deltas, not one blob`);
  const tail = exact
    ? stream.endsWith(turn.text)
    : stream.trimEnd().endsWith(turn.text.trimEnd());
  assert(
    tail,
    `[${tag}] every character of the returned answer was streamed, in order, as the tail of the stream` +
      (exact ? "" : " (trailing whitespace normalised)"),
  );
}

/**
 * The other half of the contract, and the half that decides what a user sees:
 * replay this turn's deltas through the chat view's own reducers and then
 * apply its finish() overwrite. Mid-flight the view shows the whole stream —
 * narration included, which is a real if transient artefact, so it is asserted
 * rather than hidden. After finish() the view shows the returned text and
 * nothing else, in both shapes.
 */
function assertViewOverwrite(turn: Asked, tag: string): void {
  const stream = turn.deltas.join("");
  const opened: ChatTurn[] = [
    { role: "you", text: question },
    { role: "stash", text: "", streaming: true },
  ];
  let view = opened;
  for (const delta of turn.deltas) view = appendDelta(view, delta);
  assert(view.length === 2, `[${tag}] streaming fills the open turn in place, it never adds turns`);
  assert(view[1].text === stream, `[${tag}] mid-flight the view shows the whole stream, narration and all`);
  assert(view[1].streaming === true, `[${tag}] the turn is still marked streaming mid-flight`);

  view = finishTurn(view, turn.text);
  assert(view.length === 2, `[${tag}] finish() replaces the open turn, it never adds one`);
  assert(
    view[1].text === turn.text,
    `[${tag}] finish() overwrites the stream: the user is left with exactly the returned answer`,
  );
  assert(view[1].streaming === undefined, `[${tag}] finish() clears the streaming flag`);
  assert(view[0].text === question, `[${tag}] earlier turns in the transcript are untouched`);
}

// --- real sidecar protocol check (free: no LLM call) -------------------------

/**
 * Spawns the real stdio server and proves it dispatches `chat` — with a
 * deliberately invalid request, so nothing reaches the model — while `ping`
 * still routes correctly on the same connection.
 */
async function checkProtocol(): Promise<void> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: sidecarDir,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const lines: string[] = [];
  const rl = createInterface({ input: child.stdout, terminal: false });
  const done = new Promise<void>((resolve) => {
    rl.on("line", (line) => {
      lines.push(line);
      if (lines.length >= 2) resolve();
    });
  });
  try {
    // `chat` with no params: dispatched, validated, rejected — no model call.
    child.stdin.write(`${JSON.stringify({ id: 1, method: "chat", params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ id: 2, method: "ping" })}\n`);
    await Promise.race([
      done,
      new Promise((_, reject) => setTimeout(() => reject(new Error("sidecar timed out")), 20_000)),
    ]);
    const replies = lines.map((l) => JSON.parse(l) as { id: number; ok: boolean; error?: string; result?: unknown });
    const chatReply = replies.find((r) => r.id === 1);
    const pingReply = replies.find((r) => r.id === 2);
    assert(chatReply?.ok === false, "server dispatches `chat` (invalid params rejected, not `unknown method`)");
    assert(
      chatReply?.error?.includes("vaultDir") === true,
      "`chat` validates params.vaultDir before touching the model",
    );
    assert(pingReply?.result === "pong", "a bad chat request leaves ping routing intact");
  } finally {
    rl.close();
    child.stdin.end();
    child.kill();
  }
}

// --- run ---------------------------------------------------------------------

const vaultDir = await seedVault();
const question = `what notes mention ${KEYWORD}?`;

try {
  const before = await snapshotVault(vaultDir);

  console.log(`vault: ${vaultDir}`);
  console.log(`question: ${question}`);
  console.log(`mode: ${real ? "REAL (one paid LLM call)" : "stubbed (no LLM call, no spend)"}`);
  console.log(`system prompt append (tone/format only, no persona):\n  ${CHAT_SYSTEM_APPEND}\n`);

  if (real) {
    const turn = await ask(vaultDir, question, chatDeps);

    console.log("--- answer (verbatim) ---");
    console.log(turn.text);
    console.log("--- end answer ---\n");

    assertScoping(chatPromptOptions(vaultDir), vaultDir);
    assert(
      turn.text.toLowerCase().includes(TARGET_ID) || turn.text.toLowerCase().includes(KEYWORD),
      `answer references the seeded note (${TARGET_ID})`,
    );
    assert(turn.text.toLowerCase().includes(TARGET_ID), "answer cites the note id, not just the keyword");

    // Which of the two shapes did this live turn take? Neither is a failure;
    // the contract below is the same either way. Recording it is how a reader
    // knows which one the paid run happened to exercise.
    const stream = turn.deltas.join("");
    const shapeSeen = stream === turn.text ? "answer-directly" : "narrate-then-search";
    console.log(`shape of this live turn: ${shapeSeen}`);
    console.log(`  streamed ${stream.length} chars in ${turn.deltas.length} deltas; answer is ${turn.text.length} chars`);
    console.log(`  stream tail: ${JSON.stringify(stream.slice(-80))}`);
    console.log(`  answer tail: ${JSON.stringify(turn.text.slice(-80))}`);
    console.log(`  exact (unnormalised) tail match also holds: ${stream.endsWith(turn.text)}`);
    if (shapeSeen === "narrate-then-search") {
      console.log(`  narration streamed ahead of the answer: ${JSON.stringify(stream.slice(0, stream.length - turn.text.length).slice(0, 120))}`);
    }
    // No independently known answer to compare against on this path — the
    // model wrote it — so the first clause of the contract is left to the
    // stubbed path, which does know.
    assertStreamContract(turn, null, shapeSeen, false);
    assertViewOverwrite(turn, shapeSeen);

    assert(
      typeof turn.session === "string" && turn.session !== "",
      "a session id came back, so the next turn can resume this conversation",
    );
    assert(same(Object.keys(turn).sort(), ["deltas", "session", "text"]), "a turn yields only text + session");
  } else {
    const captured: Capture[] = [];
    const answer = `${TARGET_ID}: the ${KEYWORD} cache is flushed every 40 minutes by the night job.`;

    // The same answer reached two ways. Only the narration differs, so any
    // assertion that passes for one and fails for the other is an assertion
    // about the model's mood rather than about this code.
    const shapes: Shape[] = [
      { name: "answer-directly", narration: "", answer },
      {
        name: "narrate-then-search",
        narration: "I'll search the vault for that.\n\n",
        answer,
      },
    ];

    for (const shape of shapes) {
      const turn = await ask(vaultDir, question, stubDeps(shape, "session-aaa", captured));
      const stream = turn.deltas.join("");

      assertStreamContract(turn, shape.answer, shape.name, true);
      assertViewOverwrite(turn, shape.name);
      assert(turn.session === "session-aaa", `[${shape.name}] the turn's session id is returned to the caller`);
      assert(
        same(Object.keys(turn).sort(), ["deltas", "session", "text"]),
        `[${shape.name}] a turn yields only text + session`,
      );

      // The shape-specific halves. Together they are the receipt for this
      // repair: equality is NOT the contract, it is a coincidence of the
      // shape where the model happens not to speak before it searches.
      if (shape.narration === "") {
        assert(
          stream === turn.text,
          "[answer-directly] with no narration the stream and the answer coincide exactly",
        );
      } else {
        assert(
          stream !== turn.text,
          "[narrate-then-search] narration streams but is not part of the answer — " +
            "the deltas do NOT concatenate to the final answer in general",
        );
        assert(
          stream.startsWith(shape.narration),
          "[narrate-then-search] the narration streamed first, ahead of the answer",
        );
      }
    }

    assertScoping(captured[0].opts, vaultDir);
    assert(captured[0].text === question, "the user's message reaches the model unmodified");
    assert(captured[0].opts.resume === undefined, "turn 1 sends no `resume` (new conversation)");

    // Continuity. The SDK may hand back a different id on a resume, so the
    // code must re-read it rather than carry the old one forward.
    const followUp = await ask(
      vaultDir,
      "which note was that?",
      stubDeps({ name: "follow-up", narration: "", answer: "It was the cache note." }, "session-bbb", captured),
      "session-aaa",
    );
    assert(captured[2].opts.resume === "session-aaa", "a later turn resumes the session the first one returned");
    assert(followUp.session === "session-bbb", "the session id is re-read from every turn, not assumed stable");

    let rejected = false;
    await chatTurn({ vaultDir, text: "   " }, stubDeps(shapes[0], "s", captured)).catch(() => {
      rejected = true;
    });
    assert(rejected, "an empty message is rejected before any model call");
    assert(captured.length === 3, "…and costs nothing (no fourth call was made)");

    await checkProtocol();
  }

  const after = await snapshotVault(vaultDir);
  assert(
    before === after,
    real
      ? "vault is byte-identical after a live chat turn: the transcript was not written to it"
      : "vault is byte-identical after the stubbed run (weak on this path — the SDK never ran; " +
          "the load-bearing version of this check is `--real`)",
  );

  const vaultText = (await readdir(vaultDir)).length;
  assert(vaultText === 3, "the vault still holds exactly the 3 seeded notes — no transcript file appeared");
} finally {
  await rm(vaultDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\nchat-demo: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nchat-demo: all assertions passed");
