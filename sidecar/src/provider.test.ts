// Provider seam (T2). Pure config parsing/defaulting and routing only — the
// claude path is never invoked here (it would spawn the Agent SDK), and the
// ollama paths (both real: T3 chat, T4 prompt) are only entered as far as
// no-HTTP guards / typed connection failures; their guts are tested in
// ollama.test.ts. probeOllama is exercised against a throwaway local HTTP
// server, so no test depends on a running Ollama.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import {
  OllamaNoModelError,
  OllamaNotReachableError,
  probeOllama,
} from "./ollama.ts";
import {
  AI_DISABLED_MESSAGE,
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

test("provider none (AI off) is accepted, with an empty model", () => {
  assert.deepEqual(coerceLlmConfig({ provider: "none" }), { provider: "none", model: "" });
  // A stray model string under none is ignored — nothing runs it anyway.
  assert.deepEqual(coerceLlmConfig({ provider: "none", model: "claude-opus-5" }), {
    provider: "none",
    model: "",
  });
});

test("provider none never reaches an LLM: both seams throw the typed message", async () => {
  const config = { provider: "none" as const, model: "" };
  await assert.rejects(() => providerRunPrompt(config)("hello"), new Error(AI_DISABLED_MESSAGE));
  await assert.rejects(
    () => providerChatTurn(config, { vaultDir: "/tmp", text: "hello" }),
    new Error(AI_DISABLED_MESSAGE),
  );
});

test("a blank model defaults per provider (claude default; ollama empty)", () => {
  assert.deepEqual(coerceLlmConfig({ provider: "claude", model: "  " }), DEFAULT_LLM_CONFIG);
  // No sensible default ollama model exists; an empty model is the typed
  // "not chosen yet" the settings UI fills in from what the daemon holds.
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
  // Chat routes to the real ollama path (T3): a blank configured model is its
  // typed pick-a-model error, thrown before any HTTP — proof of routing that
  // needs neither a daemon nor an SDK spawn.
  await assert.rejects(
    () => providerChatTurn({ provider: "ollama", model: "" }, { vaultDir: "/tmp", text: "hello" }),
    OllamaNoModelError,
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

test("probeOllama's default base URL honors STASH_OLLAMA_URL like the traffic paths", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.url, "/api/tags");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ models: [{ name: "from-env:1b" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const saved = process.env["STASH_OLLAMA_URL"];
  try {
    process.env["STASH_OLLAMA_URL"] = `http://127.0.0.1:${address.port}`;
    // No explicit URL: the probe must resolve through ollamaBaseUrl(), the
    // same helper the prompt/chat paths use — status and traffic can't diverge.
    const status = await probeOllama();
    assert.deepEqual(status, { reachable: true, models: ["from-env:1b"] });
  } finally {
    if (saved === undefined) delete process.env["STASH_OLLAMA_URL"];
    else process.env["STASH_OLLAMA_URL"] = saved;
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
