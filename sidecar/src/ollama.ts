// Ollama provider (T2: seam-ready stub). The prompt- and chat-shaped entries
// exist so the provider seam (provider.ts) can route to them today; both throw
// a typed not-implemented error with a stable message prefix until T3/T4
// replace their internals with real /api/generate and /api/chat calls.
//
// probeOllama is real already: the settings UI needs "is the daemon up, and
// which models does it hold" before the providers themselves land. Node 22's
// native fetch — no HTTP dependency.
import type { ChatTurnParams, ChatTurnResult } from "./chat.ts";
import type { RunPromptOptions } from "./llm.ts";

/** Ollama's default local endpoint. */
export const OLLAMA_BASE_URL = "http://localhost:11434";

/**
 * Stable message prefix for the not-implemented stub, discriminated on by
 * callers the same way NotAuthenticatedError's prefix is (main.ts flattens
 * errors to their message). T3/T4 delete the error along with the stubs.
 */
export const OLLAMA_NOT_IMPLEMENTED_PREFIX = "Ollama provider not implemented";

export class OllamaNotImplementedError extends Error {
  constructor(what: string) {
    super(`${OLLAMA_NOT_IMPLEMENTED_PREFIX}: ${what}`);
    this.name = "OllamaNotImplementedError";
  }
}

/** Prompt-shaped entry (mirrors llm.ts runPrompt). T3 fills this in. */
export async function ollamaPrompt(
  _text: string,
  _opts: RunPromptOptions = {},
): Promise<string> {
  throw new OllamaNotImplementedError("prompt (arrives in T3)");
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
