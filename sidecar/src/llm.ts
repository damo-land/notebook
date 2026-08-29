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
  /**
   * Built-in tools to make available, e.g. `["WebFetch"]`. Default `[]` — a
   * single-shot text call with no tools at all.
   */
  tools?: string[];
  /**
   * Tools auto-approved without a permission prompt. A tool listed in `tools`
   * but not here falls through to `permissionMode`, which in this
   * non-interactive process means the call stalls or is denied — so anything
   * in `tools` normally belongs here too. (Verified against
   * `Options.tools` / `Options.allowedTools` in the installed SDK's sdk.d.ts
   * and the Agent SDK TypeScript reference.)
   */
  allowedTools?: string[];
  /** Turn budget. Must be > 1 for a tool round trip. Default 1. */
  maxTurns?: number;
  /**
   * Observation-only callback, fired once per `tool_use` block the model
   * actually emits. It changes nothing about the call. It exists because a
   * text reply cannot distinguish a page the model FETCHED from a page it
   * merely recalls, so the enrichment proof script needs to see the tool
   * invocation itself. (`SDKAssistantMessage.message.content` carries the
   * Messages API blocks; `tool_use` is `{ type, id, name, input }` — verified
   * against the installed SDK's sdk.d.ts and @anthropic-ai/sdk's
   * `BetaToolUseBlock`.)
   */
  onToolUse?(name: string, input: unknown): void;
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

/** Prompt -> plain text response. No tools and one turn unless `opts` says otherwise. */
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
        tools: opts.tools ?? [],
        allowedTools: opts.allowedTools,
        maxTurns: opts.maxTurns ?? 1,
        persistSession: false,
      },
    })) {
      if (opts.onToolUse !== undefined && message.type === "assistant") {
        const content: unknown = message.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as { type?: unknown; name?: unknown; input?: unknown };
            if (b.type === "tool_use" && typeof b.name === "string") {
              opts.onToolUse(b.name, b.input);
            }
          }
        }
      }
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
