// Ollama chat (T3): the DIY tool loop and its RAG-lite fallback, tested as
// pure functions — the stream dep is stubbed (no HTTP, no daemon) and the two
// vault tools are canned. Only the ollamaHttpStream tests touch a socket, and
// they run against a throwaway local server / a just-released port, mirroring
// the probeOllama tests in provider.test.ts.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import {
  classifyOllamaError,
  OLLAMA_MAX_TURNS,
  OLLAMA_NO_MODEL_MESSAGE,
  ollamaChatCore,
  ollamaHttpStream,
  OllamaModelMissingError,
  OllamaNoModelError,
  OllamaNotReachableError,
  OllamaToolsUnsupportedError,
  type OllamaChatDeps,
  type OllamaChatRequest,
  type OllamaChunk,
} from "./ollama.ts";

// --- stub plumbing -----------------------------------------------------------

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
        "model qwen3:8b not found — pull it or pick another in Settings",
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
  assert.equal(missing.message, "model qwen3:8b not found — pull it or pick another in Settings");
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
      assert.ok((err as Error).message.startsWith(`Ollama not reachable at 127.0.0.1:${port}`));
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
