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
//   * responses STREAM — the deltas arrive in order and their concatenation
//     is exactly the final answer;
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
  const dir = await mkdtemp(join(tmpdir(), "notebook-chat-demo-"));
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

/**
 * Stands in for the SDK: records the options it was handed, streams the reply
 * through `onText`, and reports a session id through `onSessionId` — exactly
 * the two callbacks the real `runPrompt` fires.
 */
function stubDeps(reply: string, sessionId: string, captured: Capture[]): ChatDeps {
  return {
    runPrompt: async (text, opts = {}) => {
      captured.push({ text, opts });
      for (const delta of deltasOf(reply)) opts.onText?.(delta);
      opts.onSessionId?.(sessionId);
      return reply;
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

const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch"];

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
    assert(turn.deltas.length > 1, `answer streamed in ${turn.deltas.length} deltas, not one blob`);
    assert(turn.deltas.join("") === turn.text, "streamed deltas concatenate to exactly the final answer");
    assert(
      typeof turn.session === "string" && turn.session !== "",
      "a session id came back, so the next turn can resume this conversation",
    );
    assert(same(Object.keys(turn).sort(), ["deltas", "session", "text"]), "a turn yields only text + session");
  } else {
    const captured: Capture[] = [];
    const reply1 = `Two notes mention ${KEYWORD}: ${TARGET_ID} says the cache is flushed every 40 minutes.`;
    const turn1 = await ask(vaultDir, question, stubDeps(reply1, "session-aaa", captured));

    assertScoping(captured[0].opts, vaultDir);
    assert(captured[0].text === question, "the user's message reaches the model unmodified");
    assert(captured[0].opts.resume === undefined, "turn 1 sends no `resume` (new conversation)");
    assert(turn1.deltas.length > 1, `answer streamed in ${turn1.deltas.length} deltas, not one blob`);
    assert(turn1.deltas.join("") === turn1.text, "streamed deltas concatenate to exactly the final answer");
    assert(turn1.session === "session-aaa", "the turn's session id is returned to the caller");
    assert(same(Object.keys(turn1).sort(), ["deltas", "session", "text"]), "a turn yields only text + session");

    // Turn 2: continuity. The SDK may hand back a different id on a resume,
    // so the code must re-read it rather than carry the old one forward.
    const turn2 = await ask(
      vaultDir,
      "which note was that?",
      stubDeps("It was the cache note.", "session-bbb", captured),
      turn1.session ?? undefined,
    );
    assert(captured[1].opts.resume === "session-aaa", "turn 2 resumes the session turn 1 returned");
    assert(turn2.session === "session-bbb", "the session id is re-read from every turn, not assumed stable");

    let rejected = false;
    await chatTurn({ vaultDir, text: "   " }, stubDeps("x", "s", captured)).catch(() => {
      rejected = true;
    });
    assert(rejected, "an empty message is rejected before any model call");
    assert(captured.length === 2, "…and costs nothing (no third call was made)");

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
