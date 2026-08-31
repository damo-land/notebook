// Provider seam (T2). Pure config parsing/defaulting and routing only — the
// claude path is never invoked here (it would spawn the Agent SDK), and the
// ollama chat path is a typed stub until T3 (the prompt path is real, tested
// in ollama.test.ts). probeOllama is exercised against a throwaway local HTTP
// server, so no test depends on a running Ollama.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import {
  OLLAMA_NOT_IMPLEMENTED_PREFIX,
  OllamaNotImplementedError,
  OllamaNotReachableError,
  ollamaChat,
  probeOllama,
} from "./ollama.ts";
import {
  coerceLlmConfig,
  DEFAULT_LLM_CONFIG,
  providerChatTurn,
  providerRunPrompt,
  resolveClaudeModel,
} from "./provider.ts";

// --- coerceLlmConfig: what the Rust side sends becomes a usable config ------

test("absent/empty llm params default to claude + claude-haiku-4-5", () => {
  assert.deepEqual(coerceLlmConfig(undefined), DEFAULT_LLM_CONFIG);
  assert.deepEqual(coerceLlmConfig(null), DEFAULT_LLM_CONFIG);
  assert.deepEqual(coerceLlmConfig({}), DEFAULT_LLM_CONFIG);
  assert.deepEqual(DEFAULT_LLM_CONFIG, {
    provider: "claude",
    model: "claude-haiku-4-5",
  });
});

test("a well-formed llm object passes through", () => {
  assert.deepEqual(
    coerceLlmConfig({ provider: "ollama", model: "llama3.2:3b" }),
    { provider: "ollama", model: "llama3.2:3b" },
  );
  assert.deepEqual(
    coerceLlmConfig({ provider: "claude", model: "claude-opus-5" }),
    { provider: "claude", model: "claude-opus-5" },
  );
});

test("an unknown provider falls back to claude", () => {
  assert.deepEqual(coerceLlmConfig({ provider: "gpt-things" }), DEFAULT_LLM_CONFIG);
});

test("a blank model defaults per provider (claude default; ollama empty)", () => {
  assert.deepEqual(coerceLlmConfig({ provider: "claude", model: "  " }), DEFAULT_LLM_CONFIG);
  // No sensible default ollama model exists until T3 talks to the daemon;
  // an empty model is the typed "not chosen yet" the settings UI fills in.
  assert.deepEqual(coerceLlmConfig({ provider: "ollama" }), {
    provider: "ollama",
    model: "",
  });
});

// --- resolveClaudeModel: documented precedence -------------------------------
// explicit per-call opts.model > STASH_MODEL env > config llm.model > default

test("model precedence: explicit > STASH_MODEL > config > default", () => {
  const saved = process.env["STASH_MODEL"];
  try {
    delete process.env["STASH_MODEL"];
    assert.equal(resolveClaudeModel(undefined, ""), "claude-haiku-4-5");
    assert.equal(resolveClaudeModel(undefined, "claude-sonnet-5"), "claude-sonnet-5");
    assert.equal(resolveClaudeModel("claude-opus-5", "claude-sonnet-5"), "claude-opus-5");

    process.env["STASH_MODEL"] = "claude-from-env";
    // env beats the configured model …
    assert.equal(resolveClaudeModel(undefined, "claude-sonnet-5"), "claude-from-env");
    // … but an explicit per-call model still wins over everything.
    assert.equal(resolveClaudeModel("claude-opus-5", "claude-sonnet-5"), "claude-opus-5");

    // A blank env var is unset, not "the empty-string model".
    process.env["STASH_MODEL"] = "   ";
    assert.equal(resolveClaudeModel(undefined, "claude-sonnet-5"), "claude-sonnet-5");
  } finally {
    if (saved === undefined) delete process.env["STASH_MODEL"];
    else process.env["STASH_MODEL"] = saved;
  }
});

// --- the ollama chat stub: typed, stable-prefixed not-implemented ------------

test("ollama chat entry throws the typed not-implemented error", async () => {
  await assert.rejects(
    () => ollamaChat({ vaultDir: "/tmp", text: "hi" }),
    (err: unknown) => {
      assert.ok(err instanceof OllamaNotImplementedError);
      assert.ok(
        (err as Error).message.startsWith(OLLAMA_NOT_IMPLEMENTED_PREFIX),
        `stable prefix missing: ${(err as Error).message}`,
      );
      return true;
    },
  );
});

test("the seam routes provider ollama to the ollama module (no SDK spawn)", async () => {
  const config = { provider: "ollama" as const, model: "llama3.2:3b" };
  // The prompt path is real now, so point it at a port nothing listens on:
  // the typed not-reachable error can only come from the ollama module.
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));

  const saved = process.env["STASH_OLLAMA_URL"];
  try {
    process.env["STASH_OLLAMA_URL"] = `http://127.0.0.1:${port}`;
    await assert.rejects(
      () => providerRunPrompt(config)("hello"),
      OllamaNotReachableError,
    );
  } finally {
    if (saved === undefined) delete process.env["STASH_OLLAMA_URL"];
    else process.env["STASH_OLLAMA_URL"] = saved;
  }
  await assert.rejects(
    () => providerChatTurn(config, { vaultDir: "/tmp", text: "hello" }),
    OllamaNotImplementedError,
  );
});

// --- probeOllama: typed reachability, never a throw --------------------------

test("probeOllama returns the model list from /api/tags", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.url, "/api/tags");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ models: [{ name: "llama3.2:3b" }, { name: "qwen3:8b" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  try {
    const status = await probeOllama(`http://127.0.0.1:${address.port}`);
    assert.deepEqual(status, { reachable: true, models: ["llama3.2:3b", "qwen3:8b"] });
  } finally {
    server.close();
  }
});

test("probeOllama reports unreachable instead of throwing when the daemon is down", async () => {
  // Grab a port the OS just released: nothing is listening on it.
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));

  const status = await probeOllama(`http://127.0.0.1:${port}`, 1500);
  assert.deepEqual(status, { reachable: false, models: [] });
});

test("probeOllama tolerates a malformed tags payload", async () => {
  const server = http.createServer((_req, res) => res.end("not json"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  try {
    const status = await probeOllama(`http://127.0.0.1:${address.port}`);
    assert.deepEqual(status, { reachable: false, models: [] });
  } finally {
    server.close();
  }
});
