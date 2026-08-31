// Ollama provider tests, both entry shapes:
//
//   * chat (T3): the DIY tool loop and its RAG-lite fallback, tested as pure
//     functions — the stream dep is stubbed (no HTTP, no daemon) and the two
//     vault tools are canned; only the ollamaHttpStream tests touch a socket.
//   * prompt/enrichment (T4): everything runs against a throwaway local HTTP
//     server standing in for the daemon — no Ollama, no model, no spend. The
//     degradation tests mirror enrich.test.ts: any failure must leave the
//     note byte-identical, with no `enriched` marker and no stray temp files,
//     so a later run re-enriches it.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichNote, type EnrichDeps } from "./enrich.ts";
import {
  classifyOllamaError,
  OLLAMA_MAX_TURNS,
  OLLAMA_MODEL_MISSING_PREFIX,
  OLLAMA_MODEL_MISSING_SUFFIX,
  OLLAMA_NO_MODEL_MESSAGE,
  OLLAMA_NOT_REACHABLE_PREFIX,
  ollamaChatCore,
  ollamaHttpStream,
  OllamaModelMissingError,
  OllamaNoModelError,
  OllamaNotReachableError,
  ollamaPrompt,
  OllamaToolsUnsupportedError,
  type OllamaChatDeps,
  type OllamaChatRequest,
  type OllamaChunk,
} from "./ollama.ts";
import { providerRunPrompt } from "./provider.ts";

// --- chat stub plumbing ------------------------------------------------------

/** One streamed text delta. */
const text = (s: string): OllamaChunk => ({ message: { content: s } });
/** One streamed (complete, pre-parsed) tool call. */
const toolCall = (name: string, args: Record<string, unknown>): OllamaChunk => ({
  message: { tool_calls: [{ function: { name, arguments: args } }] },
});
const done: OllamaChunk = { done: true };

/**
 * Deps with a scripted stream: `respond(req, i)` returns the chunks of the
 * i-th model call (or throws, as the HTTP layer would). Requests are cloned
 * at call time because the loop mutates its messages array between calls.
 */
function stubDeps(respond: (req: OllamaChatRequest, i: number) => OllamaChunk[]) {
  const requests: OllamaChatRequest[] = [];
  const logs: string[] = [];
  const deps: OllamaChatDeps = {
    stream: async function* (req) {
      requests.push(structuredClone(req));
      yield* respond(req, requests.length - 1);
    },
    searchNotes: (_vaultDir, query) =>
      Promise.resolve(
        JSON.stringify({
          query,
          count: 1,
          matches: [{ id: "note-1", title: "Sourdough log", snippet: "Kevin doubled in 5h" }],
        }),
      ),
    readNote: (_vaultDir, idOrPath) =>
      Promise.resolve(JSON.stringify({ id: idOrPath, body: `full body of ${idOrPath}` })),
    ragOnlyModels: new Set<string>(),
    log: (line) => logs.push(line),
  };
  return { deps, requests, logs };
}

const PARAMS = { vaultDir: "/vault", text: "what about my sourdough starter?" };

// --- tool loop ---------------------------------------------------------------

test("tool loop: search_notes call feeds back and the final turn is the answer", async () => {
  const { deps, requests, logs } = stubDeps((_req, i) =>
    i === 0
      ? [toolCall("search_notes", { query: "sourdough" }), done]
      : [text("Kevin "), text("doubled. (note-1)"), done],
  );
  const deltas: string[] = [];
  const result = await ollamaChatCore("qwen3:8b", PARAMS, deps, {
    onText: (d) => deltas.push(d),
  });

  assert.equal(result.text, "Kevin doubled. (note-1)");
  // No SDK session: continuity is transcript replay, so nothing to resume.
  assert.equal(result.session, null);
  assert.equal(requests.length, 2);

  // Call 1 offers both tools and carries system + user.
  assert.equal(requests[0]!.tools?.length, 2);
  assert.deepEqual(
    requests[0]!.messages.map((m) => m.role),
    ["system", "user"],
  );

  // Call 2 replays the assistant's tool call plus the tool result.
  const msgs = requests[1]!.messages;
  const assistant = msgs[msgs.length - 2]!;
  const tool = msgs[msgs.length - 1]!;
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.tool_calls?.[0]?.function.name, "search_notes");
  assert.equal(tool.role, "tool");
  assert.equal(tool.tool_name, "search_notes");
  assert.ok(tool.content.includes("Sourdough log"), `tool result fed back: ${tool.content}`);

  // Streaming reached the hook; mechanism was logged once.
  assert.deepEqual(deltas, ["Kevin ", "doubled. (note-1)"]);
  assert.equal(logs.filter((l) => l.includes("tool-loop")).length, 1);
});

test("tool loop: read_note dispatches and an unknown tool feeds back an error result", async () => {
  const { deps, requests } = stubDeps((_req, i) =>
    i === 0
      ? [toolCall("read_note", { id_or_path: "note-1" }), toolCall("frobnicate", {}), done]
      : [text("done"), done],
  );
  const result = await ollamaChatCore("qwen3:8b", PARAMS, deps, {});
  assert.equal(result.text, "done");

  const toolMsgs = requests[1]!.messages.filter((m) => m.role === "tool");
  assert.equal(toolMsgs.length, 2);
  assert.ok(toolMsgs[0]!.content.includes("full body of note-1"));
  assert.ok(toolMsgs[1]!.content.includes("unknown tool"));
});

test("tool loop: capped at OLLAMA_MAX_TURNS model calls", async () => {
  const { deps, requests } = stubDeps(() => [toolCall("search_notes", { query: "again" }), done]);
  const result = await ollamaChatCore("qwen3:8b", PARAMS, deps, {});
  assert.equal(requests.length, OLLAMA_MAX_TURNS);
  // Truthful note instead of an empty answer or a raw error.
  assert.ok(result.text.length > 0);
});

test("transcript replay: history precedes the new message on both paths", async () => {
  const history = [
    { role: "user" as const, content: "earlier question" },
    { role: "assistant" as const, content: "earlier answer" },
  ];
  const { deps, requests } = stubDeps(() => [text("ok"), done]);
  await ollamaChatCore("qwen3:8b", { ...PARAMS, history }, deps, {});
  assert.deepEqual(
    requests[0]!.messages.map((m) => [m.role, m.content.includes("earlier") ? m.content : "-"]),
    [
      ["system", "-"],
      ["user", "earlier question"],
      ["assistant", "earlier answer"],
      ["user", "-"],
    ],
  );

  // Same on the RAG-lite path.
  const rag = stubDeps(() => [text("ok"), done]);
  rag.deps.ragOnlyModels.add("qwen3:8b");
  await ollamaChatCore("qwen3:8b", { ...PARAMS, history }, rag.deps, {});
  assert.deepEqual(
    rag.requests[0]!.messages.map((m) => m.role),
    ["system", "user", "assistant", "user"],
  );
});

// --- RAG-lite fallback -------------------------------------------------------

test("model rejecting tools falls back to RAG-lite and is remembered for the session", async () => {
  const { deps, requests, logs } = stubDeps((_req, i) => {
    if (i === 0) throw new OllamaToolsUnsupportedError("plain-model");
    return [text("rag answer"), done];
  });
  const deltas: string[] = [];
  const result = await ollamaChatCore("plain-model", PARAMS, deps, {
    onText: (d) => deltas.push(d),
  });

  assert.equal(result.text, "rag answer");
  assert.deepEqual(deltas, ["rag answer"]);
  assert.equal(requests.length, 2);
  assert.ok(requests[0]!.tools !== undefined, "first attempt offers tools");
  assert.equal(requests[1]!.tools, undefined, "fallback is single-shot, no tools");
  // Search hits are injected into the prompt.
  const user = requests[1]!.messages[requests[1]!.messages.length - 1]!;
  assert.ok(user.content.includes("Sourdough log"), `hits injected: ${user.content}`);
  assert.ok(deps.ragOnlyModels.has("plain-model"));

  // Next turn on the same model skips tools entirely (one call, no tools).
  await ollamaChatCore("plain-model", PARAMS, deps, {});
  assert.equal(requests.length, 3);
  assert.equal(requests[2]!.tools, undefined);
  assert.ok(logs.some((l) => l.includes("rag-lite")), `mechanism logged: ${logs.join(" | ")}`);
});

test("a non-tools error mid-loop propagates instead of falling back", async () => {
  const { deps } = stubDeps(() => [{ error: "model 'qwen3:8b' not found" }]);
  await assert.rejects(
    () => ollamaChatCore("qwen3:8b", PARAMS, deps, {}),
    (err: unknown) => {
      assert.ok(err instanceof OllamaModelMissingError);
      assert.equal(
        (err as Error).message,
        `${OLLAMA_MODEL_MISSING_PREFIX}: qwen3:8b — ${OLLAMA_MODEL_MISSING_SUFFIX}`,
      );
      return true;
    },
  );
});

// --- guards ------------------------------------------------------------------

test("an empty configured model is a typed, friendly error before any HTTP", async () => {
  const { deps, requests } = stubDeps(() => [text("never"), done]);
  await assert.rejects(
    () => ollamaChatCore("", PARAMS, deps, {}),
    (err: unknown) => {
      assert.ok(err instanceof OllamaNoModelError);
      assert.equal((err as Error).message, OLLAMA_NO_MODEL_MESSAGE);
      return true;
    },
  );
  assert.equal(requests.length, 0);
});

test("a blank message is rejected", async () => {
  const { deps } = stubDeps(() => [done]);
  await assert.rejects(() => ollamaChatCore("qwen3:8b", { vaultDir: "/v", text: "  " }, deps, {}));
});

// --- error classification ----------------------------------------------------

test("classifyOllamaError: tools-unsupported, model-missing, generic", () => {
  assert.ok(
    classifyOllamaError(400, 'model "m" does not support tools', "m") instanceof
      OllamaToolsUnsupportedError,
  );
  const missing = classifyOllamaError(404, "model 'x' not found", "qwen3:8b");
  assert.ok(missing instanceof OllamaModelMissingError);
  assert.equal(
    missing.message,
    `${OLLAMA_MODEL_MISSING_PREFIX}: qwen3:8b — ${OLLAMA_MODEL_MISSING_SUFFIX}`,
  );
  const generic = classifyOllamaError(500, "boom", "m");
  assert.ok(!(generic instanceof OllamaModelMissingError));
  assert.ok(!(generic instanceof OllamaToolsUnsupportedError));
});

// --- the real HTTP stream (local sockets only) -------------------------------

test("ollamaHttpStream: connection refused becomes OllamaNotReachableError", async () => {
  // Grab a port the OS just released: nothing is listening on it.
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));

  const stream = ollamaHttpStream(`http://127.0.0.1:${port}`);
  await assert.rejects(
    async () => {
      for await (const _ of stream({ model: "m", messages: [] })) void _;
    },
    (err: unknown) => {
      assert.ok(err instanceof OllamaNotReachableError);
      assert.ok(
        (err as Error).message.startsWith(OLLAMA_NOT_REACHABLE_PREFIX),
        `stable prefix missing: ${(err as Error).message}`,
      );
      assert.ok((err as Error).message.includes(`127.0.0.1:${port}`));
      return true;
    },
  );
});

test("ollamaHttpStream: NDJSON lines parse into chunks; HTTP 404 classifies", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/chat") {
      res.setHeader("content-type", "application/x-ndjson");
      res.write(JSON.stringify({ message: { role: "assistant", content: "hel" }, done: false }) + "\n");
      res.write(JSON.stringify({ message: { role: "assistant", content: "lo" }, done: true }) + "\n");
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  try {
    const stream = ollamaHttpStream(`http://127.0.0.1:${address.port}`);
    const chunks: OllamaChunk[] = [];
    for await (const c of stream({ model: "m", messages: [] })) chunks.push(c);
    assert.deepEqual(
      chunks.map((c) => c.message?.content),
      ["hel", "lo"],
    );
  } finally {
    server.close();
  }

  const notFound = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "model 'm' not found" }));
  });
  await new Promise<void>((resolve) => notFound.listen(0, "127.0.0.1", resolve));
  const nfAddress = notFound.address();
  assert.ok(nfAddress !== null && typeof nfAddress === "object");
  try {
    const stream = ollamaHttpStream(`http://127.0.0.1:${nfAddress.port}`);
    await assert.rejects(
      async () => {
        for await (const _ of stream({ model: "m", messages: [] })) void _;
      },
      OllamaModelMissingError,
    );
  } finally {
    notFound.close();
  }
});

// --- prompt/enrichment plumbing (T4) -----------------------------------------

const MODEL = "llama3.2:3b";

const NOTE =
  "---\nid: k-test\ncreated: 2026-08-30T10:00:00Z\nkind: knowledge\n---\nA note body.\n";

/** One JSON-in-a-chat-reply body, the shape `POST /api/chat` answers with. */
function chatReply(content: string): string {
  return JSON.stringify({
    model: MODEL,
    message: { role: "assistant", content },
    done: true,
  });
}

const GOOD_REPLY = chatReply(
  JSON.stringify({ tags: ["local-llm"], context: "Some context." }),
);

interface Stub {
  url: string;
  requests: { url: string; body: string }[];
  close(): Promise<void>;
}

/**
 * Local daemon stand-in. `replies` are served in order (status + body);
 * the last one repeats if more requests arrive.
 */
async function startStub(replies: { status?: number; body: string }[]): Promise<Stub> {
  const requests: Stub["requests"] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ url: req.url ?? "", body });
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
      res.statusCode = reply.status ?? 200;
      res.setHeader("content-type", "application/json");
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** A port nothing listens on: grabbed from the OS and released again. */
async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** A fresh vault dir holding the one canonical unenriched note. */
async function makeVault(): Promise<{ vaultDir: string; path: string }> {
  const vaultDir = await mkdtemp(join(tmpdir(), "enrich-ollama-"));
  const path = join(vaultDir, "k-test.md");
  await writeFile(path, NOTE, "utf8");
  return { vaultDir, path };
}

/** The exact deps main.ts builds for an ollama enrich job, aimed at `url`. */
function ollamaDeps(url: string): EnrichDeps {
  return {
    runPrompt: (text, opts) =>
      ollamaPrompt(text, { ...opts, model: MODEL }, url),
    retryMalformedReplyOnce: true,
  };
}

/** Asserts the vault is exactly as `makeVault` left it: one untouched note. */
async function assertUntouched(vaultDir: string, path: string): Promise<void> {
  assert.equal(await readFile(path, "utf8"), NOTE);
  assert.deepEqual(await readdir(vaultDir), ["k-test.md"]);
}

// --- ollamaPrompt: the single-shot /api/chat call ----------------------------

test("ollamaPrompt posts one non-streaming /api/chat turn and returns the text", async () => {
  const stub = await startStub([{ body: chatReply("hello back") }]);
  try {
    const reply = await ollamaPrompt("hello", { model: MODEL }, stub.url);
    assert.equal(reply, "hello back");
    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0].url, "/api/chat");
    assert.deepEqual(JSON.parse(stub.requests[0].body), {
      model: MODEL,
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });
  } finally {
    await stub.close();
  }
});

test("ollamaPrompt types a refused connection as OllamaNotReachableError", async () => {
  const port = await closedPort();
  await assert.rejects(
    () => ollamaPrompt("hello", { model: MODEL }, `http://127.0.0.1:${port}`),
    (err: unknown) => {
      assert.ok(err instanceof OllamaNotReachableError);
      assert.ok(
        (err as Error).message.startsWith(OLLAMA_NOT_REACHABLE_PREFIX),
        `stable prefix missing: ${(err as Error).message}`,
      );
      return true;
    },
  );
});

test("ollamaPrompt types a 404 as OllamaModelMissingError", async () => {
  const stub = await startStub([
    { status: 404, body: JSON.stringify({ error: `model "${MODEL}" not found, try pulling it first` }) },
  ]);
  try {
    await assert.rejects(
      () => ollamaPrompt("hello", { model: MODEL }, stub.url),
      (err: unknown) => {
        assert.ok(err instanceof OllamaModelMissingError);
        assert.ok(
          (err as Error).message.startsWith(OLLAMA_MODEL_MISSING_PREFIX),
          `stable prefix missing: ${(err as Error).message}`,
        );
        assert.ok((err as Error).message.includes(MODEL));
        return true;
      },
    );
  } finally {
    await stub.close();
  }
});

// --- enrichment over ollama: happy path and the retry-once contract ----------

test("ollama enrichment happy path writes tags, marker and context", async () => {
  const stub = await startStub([{ body: GOOD_REPLY }]);
  const { vaultDir, path } = await makeVault();
  try {
    const result = await enrichNote({ vaultDir, path }, ollamaDeps(stub.url));
    assert.equal(result.status, "enriched");
    assert.deepEqual(result.addedTags, ["local-llm"]);
    const written = await readFile(path, "utf8");
    assert.ok(written.includes("tags: [local-llm]"));
    assert.ok(written.includes("enriched: "));
    assert.ok(written.includes("A note body.\n"));
    assert.ok(written.includes("## Context\n\nSome context.\n"));
    assert.equal(stub.requests.length, 1);
  } finally {
    await stub.close();
  }
});

test("a malformed reply is retried exactly once, then succeeds", async () => {
  const stub = await startStub([
    { body: chatReply("I cannot answer in JSON, sorry!") },
    { body: GOOD_REPLY },
  ]);
  const { vaultDir, path } = await makeVault();
  try {
    const result = await enrichNote({ vaultDir, path }, ollamaDeps(stub.url));
    assert.equal(result.status, "enriched");
    assert.equal(stub.requests.length, 2);
  } finally {
    await stub.close();
  }
});

test("two malformed replies skip without a marker; note byte-identical", async () => {
  const stub = await startStub([{ body: chatReply("still not JSON") }]);
  const { vaultDir, path } = await makeVault();
  try {
    await assert.rejects(
      () => enrichNote({ vaultDir, path }, ollamaDeps(stub.url)),
      /no JSON object/,
    );
    // One retry, no more — and nothing written, so a later run re-enriches.
    assert.equal(stub.requests.length, 2);
    await assertUntouched(vaultDir, path);
  } finally {
    await stub.close();
  }
});

test("without the ollama retry flag a malformed reply throws after ONE call", async () => {
  // The claude-provider deps shape: no retryMalformedReplyOnce. Guards that
  // the claude path kept its original single-shot parse behaviour.
  const stub = await startStub([{ body: chatReply("not JSON either") }]);
  const { vaultDir, path } = await makeVault();
  try {
    await assert.rejects(
      () =>
        enrichNote(
          { vaultDir, path },
          { runPrompt: (text, opts) => ollamaPrompt(text, { ...opts, model: MODEL }, stub.url) },
        ),
      /no JSON object/,
    );
    assert.equal(stub.requests.length, 1);
    await assertUntouched(vaultDir, path);
  } finally {
    await stub.close();
  }
});

// --- enrichment over ollama: unified degradation -----------------------------

test("unreachable daemon: typed error, exactly one attempt, nothing written", async () => {
  const port = await closedPort();
  const { vaultDir, path } = await makeVault();
  let calls = 0;
  const deps: EnrichDeps = {
    runPrompt: (text, opts) => {
      calls += 1;
      return ollamaPrompt(text, { ...opts, model: MODEL }, `http://127.0.0.1:${port}`);
    },
    retryMalformedReplyOnce: true,
  };
  await assert.rejects(() => enrichNote({ vaultDir, path }, deps), OllamaNotReachableError);
  // A call failure is not a parse failure: the retry-once flag must not
  // hammer a daemon that is down.
  assert.equal(calls, 1);
  await assertUntouched(vaultDir, path);
});

test("missing model: typed error via the real provider seam, nothing written", async () => {
  const stub = await startStub([
    { status: 404, body: JSON.stringify({ error: `model "${MODEL}" not found` }) },
  ]);
  const { vaultDir, path } = await makeVault();
  const saved = process.env["STASH_OLLAMA_URL"];
  try {
    // Through providerRunPrompt — the exact wiring main.ts uses — with the
    // daemon endpoint redirected at the stub.
    process.env["STASH_OLLAMA_URL"] = stub.url;
    const deps: EnrichDeps = {
      runPrompt: providerRunPrompt({ provider: "ollama", model: MODEL }),
      retryMalformedReplyOnce: true,
    };
    await assert.rejects(() => enrichNote({ vaultDir, path }, deps), OllamaModelMissingError);
    assert.equal(stub.requests.length, 1);
    await assertUntouched(vaultDir, path);
  } finally {
    if (saved === undefined) delete process.env["STASH_OLLAMA_URL"];
    else process.env["STASH_OLLAMA_URL"] = saved;
    await stub.close();
  }
});
