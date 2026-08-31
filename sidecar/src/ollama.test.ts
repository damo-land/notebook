// Ollama enrichment + unified degradation (T4). Everything runs against a
// throwaway local HTTP server standing in for the daemon — no Ollama, no
// model, no spend. The degradation tests mirror enrich.test.ts: any failure
// must leave the note byte-identical, with no `enriched` marker and no stray
// temp files, so a later run re-enriches it.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichNote, type EnrichDeps } from "./enrich.ts";
import {
  OLLAMA_MODEL_MISSING_PREFIX,
  OLLAMA_NOT_REACHABLE_PREFIX,
  OllamaModelMissingError,
  OllamaNotReachableError,
  ollamaPrompt,
} from "./ollama.ts";
import { providerRunPrompt } from "./provider.ts";

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
