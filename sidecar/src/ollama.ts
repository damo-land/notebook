// Ollama provider. The prompt-shaped entry (ollamaPrompt, T4) is real: one
// single-shot, non-streaming POST /api/chat, no tools. The chat-shaped entry
// is still the T2 typed not-implemented stub until T3 replaces it.
//
// Failures are typed the way llm.ts types auth failures: a stable message
// prefix is the discriminator once main.ts flattens errors to their message.
// Two states get their own type — daemon down (OllamaNotReachableError) and
// model not installed (OllamaModelMissingError) — because the Rust enrich
// worker and the settings UI say different things for each.
//
// probeOllama serves the settings UI: "is the daemon up, and which models does
// it hold". Node 22's native fetch throughout — no HTTP dependency.
import type { ChatTurnParams, ChatTurnResult } from "./chat.ts";
import type { RunPromptOptions } from "./llm.ts";

/** Ollama's default local endpoint. */
export const OLLAMA_BASE_URL = "http://localhost:11434";

/** The daemon endpoint: STASH_OLLAMA_URL env override, else the default. */
export function ollamaBaseUrl(): string {
  const env = process.env["STASH_OLLAMA_URL"];
  return env !== undefined && env.trim() !== "" ? env.trim() : OLLAMA_BASE_URL;
}

/**
 * Stable message prefix for the not-implemented chat stub, discriminated on by
 * callers the same way NotAuthenticatedError's prefix is (main.ts flattens
 * errors to their message). T3 deletes the error along with the stub.
 */
export const OLLAMA_NOT_IMPLEMENTED_PREFIX = "Ollama provider not implemented";

export class OllamaNotImplementedError extends Error {
  constructor(what: string) {
    super(`${OLLAMA_NOT_IMPLEMENTED_PREFIX}: ${what}`);
    this.name = "OllamaNotImplementedError";
  }
}

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
 * (HTTP 404 from /api/chat). The Rust enrich worker matches on this exact
 * string.
 */
export const OLLAMA_MODEL_MISSING_PREFIX = "Ollama model missing";

export class OllamaModelMissingError extends Error {
  constructor(detail: string) {
    super(`${OLLAMA_MODEL_MISSING_PREFIX}: ${detail}`);
    this.name = "OllamaModelMissingError";
  }
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

/** Chat-shaped entry (mirrors chat.ts chatTurn). T4 fills this in. */
export async function ollamaChat(
  _params: ChatTurnParams,
  _hooks: { onText?(delta: string): void } = {},
): Promise<ChatTurnResult> {
  throw new OllamaNotImplementedError("chat (arrives in T4)");
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
