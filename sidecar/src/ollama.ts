// Ollama provider. Both entry shapes are real:
//
//   * ollamaChat (T3): a DIY bounded tool loop against POST /api/chat (native
//     fetch, NDJSON streaming, no dependencies) with a RAG-lite single-shot
//     fallback, per the T1 scout verdict — the model is offered
//     search_notes/read_note, its tool calls execute against the vault
//     (vault.ts) and results feed back until a final answer, capped at
//     OLLAMA_MAX_TURNS model calls; a model that rejects tools (HTTP 400
//     "does not support tools") falls back to RAG-lite — top vault search
//     hits injected into a single streamed prompt — and is remembered as
//     rag-only for the session. Conversation continuity is transcript replay:
//     the frontend resends its full transcript as `history` each turn (there
//     is no session to resume, so ChatTurnResult.session is always null).
//     The loop core (ollamaChatCore + runToolLoop/runRagLite) is pure over
//     injected deps — stream, searchNotes, readNote — and unit-tested with a
//     stubbed stream in ollama.test.ts; ollamaHttpStream is the one real-HTTP
//     piece.
//
//   * ollamaPrompt (T4): the prompt/enrich shape — one single-shot,
//     non-streaming POST /api/chat, no tools.
//
// Failures are typed the way llm.ts types auth failures: a stable message
// prefix is the discriminator once main.ts flattens errors to their message.
// Two states get their own type, shared by both entries — daemon down
// (OllamaNotReachableError) and model not installed (OllamaModelMissingError)
// — because the Rust enrich worker and the chat transcript say different
// things for each.
//
// probeOllama serves the settings UI: "is the daemon up, and which models does
// it hold". Node 22's native fetch throughout — no HTTP dependency.
import type { ChatHistoryTurn, ChatTurnParams, ChatTurnResult } from "./chat.ts";
import type { RunPromptOptions } from "./llm.ts";
import { readVaultNote, searchVault } from "./vault.ts";

/** Ollama's default local endpoint. */
export const OLLAMA_BASE_URL = "http://localhost:11434";

/** The daemon endpoint: STASH_OLLAMA_URL env override, else the default. */
export function ollamaBaseUrl(): string {
  const env = process.env["STASH_OLLAMA_URL"];
  return env !== undefined && env.trim() !== "" ? env.trim() : OLLAMA_BASE_URL;
}

/** `localhost:11434` — how error messages name the endpoint. */
function hostLabel(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, "");
}

// --- typed errors ------------------------------------------------------------
// Same pattern as NotAuthenticatedError (llm.ts): stable message prefixes the
// consumers can match on, because main.ts flattens errors to their message.
// One error pair serves BOTH entries: the Rust enrich worker matches the
// prefixes to log a typed skip, and chat-view.tsx matches fragments of the
// same messages to render them as in-transcript guidance.

/**
 * Stable prefix: the daemon did not answer at all (refused connection, DNS,
 * timeout). The Rust enrich worker matches on this exact string.
 */
export const OLLAMA_NOT_REACHABLE_PREFIX = "Ollama is not reachable";

export class OllamaNotReachableError extends Error {
  constructor(detail: string) {
    super(`${OLLAMA_NOT_REACHABLE_PREFIX}. ${detail}`);
    this.name = "OllamaNotReachableError";
  }
}

/**
 * Stable prefix: the daemon is up but does not hold the configured model
 * (HTTP 404 from /api/chat, or an equivalent streamed error chunk). The Rust
 * enrich worker matches on this exact string.
 */
export const OLLAMA_MODEL_MISSING_PREFIX = "Ollama model missing";

/**
 * Stable suffix of the chat path's model-missing detail; chat-view.tsx
 * matches it to keep the message in-transcript guidance rather than a raw
 * error dump.
 */
export const OLLAMA_MODEL_MISSING_SUFFIX = "pull it or pick another in Settings";

export class OllamaModelMissingError extends Error {
  constructor(detail: string) {
    super(`${OLLAMA_MODEL_MISSING_PREFIX}: ${detail}`);
    this.name = "OllamaModelMissingError";
  }
}

/** Exact message: provider is ollama but no model was ever chosen. */
export const OLLAMA_NO_MODEL_MESSAGE = "no Ollama model selected — pick one in Settings";

export class OllamaNoModelError extends Error {
  constructor() {
    super(OLLAMA_NO_MODEL_MESSAGE);
    this.name = "OllamaNoModelError";
  }
}

/**
 * Internal signal, never user-facing: the model rejected the tools array.
 * ollamaChatCore catches it and falls back to RAG-lite.
 */
export class OllamaToolsUnsupportedError extends Error {
  constructor(model: string) {
    super(`model ${model} does not support tools`);
    this.name = "OllamaToolsUnsupportedError";
  }
}

/**
 * One classifier for every failure body Ollama hands back, whether from a
 * non-2xx response or an `{"error": ...}` NDJSON chunk. Status is secondary
 * evidence; the error text is primary (shapes observed via the T1 probe
 * scripts: 404 `model 'x' not found`, 400 `... does not support tools`).
 */
export function classifyOllamaError(
  status: number | null,
  text: string,
  model: string,
): Error {
  const t = text.toLowerCase();
  if (t.includes("does not support tools")) return new OllamaToolsUnsupportedError(model);
  if (status === 404 || t.includes("not found")) {
    return new OllamaModelMissingError(`${model} — ${OLLAMA_MODEL_MISSING_SUFFIX}`);
  }
  return new Error(`Ollama error: ${text.slice(0, 300)}`);
}

// --- /api/chat shapes --------------------------------------------------------

export interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  /** On role:"tool" messages: which tool this result answers. */
  tool_name?: string;
}

interface OllamaToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaToolDef[];
}

/**
 * One parsed NDJSON line of a streamed /api/chat response. Per the T1 probes'
 * encoding of the API: a chunk carries either a text delta
 * (`message.content`), complete pre-parsed tool call(s)
 * (`message.tool_calls`, arguments already an object — never split across
 * chunks), a `thinking` delta (ignored here), or a daemon `error`.
 */
export interface OllamaChunk {
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  done?: boolean;
  error?: string;
}

export type OllamaStream = (req: OllamaChatRequest) => AsyncIterable<OllamaChunk>;

/** Injected by ollamaChat, stubbed by tests. */
export interface OllamaChatDeps {
  stream: OllamaStream;
  /** search_notes backend: JSON string of hits for a query. */
  searchNotes(vaultDir: string, query: string): Promise<string>;
  /** read_note backend: JSON string of one note's frontmatter + body. */
  readNote(vaultDir: string, idOrPath: string): Promise<string>;
  /** Models that rejected tools this session; RAG-lite from then on. */
  ragOnlyModels: Set<string>;
  log(line: string): void;
}

// --- tools & prompts ---------------------------------------------------------

export const OLLAMA_TOOLS: OllamaToolDef[] = [
  {
    type: "function",
    function: {
      name: "search_notes",
      description:
        "Search the user's markdown notes vault. Case-insensitive keyword match over " +
        "titles, tags and bodies; returns matching note ids, titles and snippets as JSON.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords to search the vault for" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_note",
      description:
        "Read one note in full by id (filename without .md) or vault-relative path, " +
        "as returned by search_notes. Returns the note's frontmatter and body as JSON.",
      parameters: {
        type: "object",
        properties: {
          id_or_path: { type: "string", description: "Note id or vault-relative path" },
        },
        required: ["id_or_path"],
      },
    },
  },
];

/**
 * Model-call budget per chat message. Mirrors CHAT_MAX_TURNS on the claude
 * path: a search and a couple of reads are 3+ calls before the answer.
 */
export const OLLAMA_MAX_TURNS = 8;

/** Grounding rules shared by both mechanisms (mirrors CHAT_SYSTEM_APPEND). */
const GROUNDING =
  "Cite the id of every note you used. Keep answers short and plain; no preamble, " +
  "no sign-off. If nothing in the vault matches, say so — never invent note contents.";

export const OLLAMA_TOOL_SYSTEM =
  "You are answering questions about the user's personal notes vault. Use the " +
  "search_notes tool to find relevant notes and the read_note tool to read them " +
  "before you answer — never answer from memory. " +
  GROUNDING;

export const OLLAMA_RAG_SYSTEM =
  "You are answering questions about the user's personal notes vault. The user's " +
  "message is followed by a JSON block of vault notes that matched a search for it; " +
  "answer ONLY from those notes. " +
  GROUNDING;

/** What the model is told when the tool budget runs out mid-search. */
export const OLLAMA_BUDGET_MESSAGE =
  "(I ran out of tool-call budget before finding an answer in the vault — try a more specific question.)";

// --- the loop core (pure over deps) ------------------------------------------

function historyMessages(history: ChatHistoryTurn[] | undefined): OllamaMessage[] {
  return (history ?? []).map((h) => ({ role: h.role, content: h.content }));
}

/**
 * Drain one streamed model call: text deltas accumulate (and reach onText —
 * the same all-deltas-are-a-preview contract as the claude path), tool calls
 * collect, `thinking` deltas are dropped, a daemon error chunk throws
 * classified.
 */
async function drainCall(
  stream: AsyncIterable<OllamaChunk>,
  model: string,
  onText?: (delta: string) => void,
): Promise<{ content: string; calls: OllamaToolCall[] }> {
  let content = "";
  const calls: OllamaToolCall[] = [];
  for await (const chunk of stream) {
    if (typeof chunk.error === "string" && chunk.error !== "") {
      throw classifyOllamaError(null, chunk.error, model);
    }
    const m = chunk.message;
    if (m?.content !== undefined && m.content !== "") {
      content += m.content;
      onText?.(m.content);
    }
    if (m?.tool_calls !== undefined) calls.push(...m.tool_calls);
  }
  return { content, calls };
}

/** Execute one tool call against the vault. Failures FEED BACK to the model
 * as an error result rather than aborting the turn. */
export async function dispatchToolCall(
  vaultDir: string,
  call: OllamaToolCall,
  deps: Pick<OllamaChatDeps, "searchNotes" | "readNote">,
): Promise<string> {
  const name = call.function?.name ?? "";
  const args = call.function?.arguments ?? {};
  try {
    if (name === "search_notes") {
      const query = typeof args["query"] === "string" ? args["query"] : "";
      if (query === "") return JSON.stringify({ error: "search_notes needs a query string" });
      return await deps.searchNotes(vaultDir, query);
    }
    if (name === "read_note") {
      const target = ["id_or_path", "id", "path"]
        .map((k) => args[k])
        .find((v): v is string => typeof v === "string" && v !== "");
      if (target === undefined) {
        return JSON.stringify({ error: "read_note needs an id_or_path string" });
      }
      return await deps.readNote(vaultDir, target);
    }
    return JSON.stringify({ error: `unknown tool: ${name}` });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * The bounded tool loop: offer tools, execute what the model calls, feed
 * results back, until a call ends with no tool calls (that call's text is the
 * answer) or the budget is spent.
 */
export async function runToolLoop(
  model: string,
  messages: OllamaMessage[],
  vaultDir: string,
  deps: OllamaChatDeps,
  onText?: (delta: string) => void,
): Promise<string> {
  let lastContent = "";
  for (let turn = 0; turn < OLLAMA_MAX_TURNS; turn++) {
    const { content, calls } = await drainCall(
      deps.stream({ model, messages, tools: OLLAMA_TOOLS }),
      model,
      onText,
    );
    if (calls.length === 0) return content.trim();
    lastContent = content;
    messages.push({ role: "assistant", content, tool_calls: calls });
    for (const call of calls) {
      messages.push({
        role: "tool",
        tool_name: call.function?.name ?? "",
        content: await dispatchToolCall(vaultDir, call, deps),
      });
    }
  }
  // Budget spent with tool calls still coming: be truthful, never empty.
  return lastContent.trim() !== "" ? lastContent.trim() : OLLAMA_BUDGET_MESSAGE;
}

/**
 * RAG-lite: single streamed call, no tools, with the top vault search hits
 * for the user's message injected into the prompt.
 */
export async function runRagLite(
  model: string,
  params: ChatTurnParams,
  deps: OllamaChatDeps,
  onText?: (delta: string) => void,
): Promise<string> {
  const hits = await deps.searchNotes(params.vaultDir, params.text);
  const messages: OllamaMessage[] = [
    { role: "system", content: OLLAMA_RAG_SYSTEM },
    ...historyMessages(params.history),
    { role: "user", content: `${params.text}\n\n[vault search results]\n${hits}` },
  ];
  const { content } = await drainCall(deps.stream({ model, messages }), model, onText);
  return content.trim();
}

/**
 * One ollama chat turn. Tool loop first unless this model already rejected
 * tools this session; the mechanism chosen is logged once per turn (twice on
 * the turn a fallback happens — that log IS the mechanism change).
 */
export async function ollamaChatCore(
  model: string,
  params: ChatTurnParams,
  deps: OllamaChatDeps,
  hooks: { onText?(delta: string): void } = {},
): Promise<ChatTurnResult> {
  if (params.text.trim() === "") throw new Error("chat requires a non-empty message");
  if (model.trim() === "") throw new OllamaNoModelError();

  if (!deps.ragOnlyModels.has(model)) {
    deps.log(`[ollama] chat mechanism: tool-loop (model ${model})`);
    try {
      const messages: OllamaMessage[] = [
        { role: "system", content: OLLAMA_TOOL_SYSTEM },
        ...historyMessages(params.history),
        { role: "user", content: params.text },
      ];
      const text = await runToolLoop(model, messages, params.vaultDir, deps, hooks.onText);
      return { text, session: null };
    } catch (err) {
      if (!(err instanceof OllamaToolsUnsupportedError)) throw err;
      deps.ragOnlyModels.add(model);
      deps.log(
        `[ollama] chat mechanism: rag-lite (model ${model} rejected tools; remembered for this session)`,
      );
    }
  } else {
    deps.log(`[ollama] chat mechanism: rag-lite (model ${model} is rag-only this session)`);
  }
  return { text: await runRagLite(model, params, deps, hooks.onText), session: null };
}

// --- the real HTTP stream ----------------------------------------------------

/**
 * A streaming /api/chat call as an async iterable of parsed NDJSON chunks.
 * Native fetch; a refused/failed connection becomes OllamaNotReachableError,
 * a non-2xx response is classified before a single chunk is yielded.
 */
export function ollamaHttpStream(baseUrl: string = ollamaBaseUrl()): OllamaStream {
  return async function* (req: OllamaChatRequest) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...req, stream: true }),
      });
    } catch {
      throw new OllamaNotReachableError(
        `Is the Ollama app running at ${hostLabel(baseUrl)}?`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw classifyOllamaError(res.status, body, req.model);
    }
    if (res.body === null) return;
    const decoder = new TextDecoder();
    let buf = "";
    for await (const raw of res.body) {
      buf += decoder.decode(raw as Uint8Array, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line !== "") yield JSON.parse(line) as OllamaChunk;
      }
    }
    const tail = buf.trim();
    if (tail !== "") yield JSON.parse(tail) as OllamaChunk;
  };
}

// --- production wiring -------------------------------------------------------

/** Session memory: models that rejected tools stay RAG-lite until restart. */
const sessionRagOnlyModels = new Set<string>();

function productionDeps(): OllamaChatDeps {
  return {
    stream: ollamaHttpStream(),
    searchNotes: async (vaultDir, query) => {
      const matches = await searchVault(vaultDir, query);
      return JSON.stringify({ query, count: matches.length, matches });
    },
    readNote: async (vaultDir, idOrPath) => JSON.stringify(await readVaultNote(vaultDir, idOrPath)),
    ragOnlyModels: sessionRagOnlyModels,
    log: (line) => console.error(line),
  };
}

/** Chat-shaped entry (mirrors chat.ts chatTurn), wired by provider.ts. */
export async function ollamaChat(
  model: string,
  params: ChatTurnParams,
  hooks: { onText?(delta: string): void } = {},
): Promise<ChatTurnResult> {
  return ollamaChatCore(model, params, productionDeps(), hooks);
}

/**
 * Prompt-shaped entry (mirrors llm.ts runPrompt): one non-streaming
 * `POST /api/chat` turn, text in, text out. Deliberately toolless — the
 * enrichment prompt's WebFetch option is a Claude-provider capability, so
 * `opts.tools`/`allowedTools`/`maxTurns` are ignored here; only `opts.model`
 * (falling back to the seam-bound config model) is honoured.
 *
 * No request timeout: local generation legitimately runs for minutes on a
 * cold model. An unreachable daemon still fails fast — the connection itself
 * is refused.
 */
export async function ollamaPrompt(
  text: string,
  opts: RunPromptOptions = {},
  baseUrl: string = ollamaBaseUrl(),
): Promise<string> {
  const model = opts.model ?? "";
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: text }],
        stream: false,
      }),
    });
  } catch (err) {
    throw new OllamaNotReachableError(
      `Is the Ollama daemon running at ${baseUrl}? (${(err as Error).message})`,
    );
  }
  if (!res.ok) {
    const detail = await res
      .text()
      .then((body) => {
        try {
          const parsed = JSON.parse(body) as { error?: unknown };
          return typeof parsed.error === "string" ? parsed.error : body;
        } catch {
          return body;
        }
      })
      .catch(() => "");
    // Ollama answers 404 for a model it does not hold ("model 'x' not found,
    // try pulling it first"). Everything else stays a plain error.
    if (res.status === 404) {
      throw new OllamaModelMissingError(
        `${model === "" ? "(no model configured)" : model} — ${detail || "not found"}`,
      );
    }
    throw new Error(`Ollama request failed (HTTP ${res.status}): ${detail}`);
  }
  const body = (await res.json().catch(() => null)) as {
    message?: { content?: unknown };
  } | null;
  const content = body?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Ollama reply had no message content");
  }
  return content;
}

export interface OllamaStatus {
  /** True when GET <base>/api/tags answered 200 with a parseable body. */
  reachable: boolean;
  /** Locally available model names; empty when unreachable. */
  models: string[];
}

/**
 * Reachability + model list from `GET <baseUrl>/api/tags`.
 *
 * Typed result, NEVER a throw: a down daemon is an expected state the settings
 * UI renders, not an error. Any failure — refused connection, timeout
 * (default 1500ms, kept short so a probe can't hang the settings view),
 * non-200, malformed body — is `{reachable: false, models: []}`.
 */
export async function probeOllama(
  baseUrl: string = OLLAMA_BASE_URL,
  timeoutMs = 1500,
): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { reachable: false, models: [] };
    const body = (await res.json()) as { models?: unknown };
    const models = Array.isArray(body.models)
      ? body.models
          .map((m) => (m as { name?: unknown } | null)?.name)
          .filter((n): n is string => typeof n === "string")
      : [];
    return { reachable: true, models };
  } catch {
    return { reachable: false, models: [] };
  }
}
