// THE only module that imports @anthropic-ai/claude-agent-sdk at runtime.
// Everything else in the sidecar goes through runPrompt() so the provider
// stays swappable.
import { query } from "@anthropic-ai/claude-agent-sdk";

/** Thrown when the Claude Code OAuth credential chain is missing/expired. */
export class NotAuthenticatedError extends Error {
  constructor(detail: string) {
    super(`Not authenticated with Claude Code. ${detail}`);
    this.name = "NotAuthenticatedError";
  }
}

export interface RunPromptOptions {
  /** Model override; defaults to NOTEBOOK_MODEL env var, else the SDK default. */
  model?: string;
}

let warnedAboutApiKey = false;

/**
 * Auth relies solely on the Claude Code OAuth credential chain (claude login /
 * claude setup-token). ANTHROPIC_API_KEY is deliberately ignored: we strip it
 * from the environment before the SDK spawns its child so billing stays on the
 * user's subscription.
 */
function stripApiKey(): void {
  if (process.env["ANTHROPIC_API_KEY"] !== undefined) {
    if (!warnedAboutApiKey) {
      console.error(
        "[sidecar] ANTHROPIC_API_KEY is set but will be IGNORED: " +
          "the sidecar authenticates via Claude Code OAuth (claude setup-token).",
      );
      warnedAboutApiKey = true;
    }
    delete process.env["ANTHROPIC_API_KEY"];
  }
}

const AUTH_ERROR_PATTERN =
  /auth|login|logged in|credential|api key|x-api-key|setup-token|oauth|token expired|401/i;

/** Single-shot prompt -> plain text response. No tools, one turn. */
export async function runPrompt(
  text: string,
  opts: RunPromptOptions = {},
): Promise<string> {
  stripApiKey();

  const model = opts.model ?? process.env["NOTEBOOK_MODEL"] ?? undefined;

  try {
    for await (const message of query({
      prompt: text,
      options: {
        model,
        tools: [],
        maxTurns: 1,
        persistSession: false,
      },
    })) {
      if (message.type === "result") {
        if (message.subtype === "success") {
          // Unauthed surfaces as a "success" result with is_error: true and
          // result text "Not logged in · Please run /login" (verified against
          // SDK 0.3.250), so is_error must be checked before trusting the text.
          if (message.is_error) {
            throw new Error(`LLM call failed: ${message.result}`);
          }
          return message.result;
        }
        throw new Error(
          `LLM call failed (${message.subtype}): ${message.errors.join("; ")}`,
        );
      }
    }
    throw new Error("LLM call ended without a result message");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (AUTH_ERROR_PATTERN.test(detail)) {
      throw new NotAuthenticatedError(detail);
    }
    throw err;
  }
}
