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
   * Working directory for the SDK session; the root the built-in filesystem
   * tools operate from. Defaults to the sidecar's own cwd. (`Options.cwd` in
   * the installed sdk.d.ts.)
   */
  cwd?: string;
  /**
   * Extra instruction appended to the Claude Code preset system prompt. The
   * preset is kept deliberately — a bare `systemPrompt` string REPLACES it,
   * which would drop the built-in tool instructions. (`Options.systemPrompt`
   * accepts `{ type: "preset", preset: "claude_code", append }` — verified in
   * the installed sdk.d.ts.)
   */
  systemPromptAppend?: string;
  /**
   * Which filesystem settings the spawned CLI loads. Default (omitted) is the
   * CLI's own: user + project + local, which would pull in a CLAUDE.md and a
   * `.claude/settings.json` sitting in `cwd`. Pass `[]` for SDK isolation
   * mode. (`Options.settingSources` in the installed sdk.d.ts.)
   */
  settingSources?: [];
  /**
   * Session id to continue, from a previous turn's `onSessionId`. Requires
   * that turn to have run with `persistSession: true`.
   * (`Options.resume` in the installed sdk.d.ts.)
   */
  resume?: string;
  /**
   * Write the session transcript to `~/.claude/projects/` so a later `resume`
   * can load it. Default false: one-shot callers want nothing on disk.
   * (`Options.persistSession` in the installed sdk.d.ts.)
   */
  persistSession?: boolean;
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
  /**
   * Streaming text, so a caller can render an answer as it arrives. Fired for
   * every `text_delta` the model emits, in order, across ALL of the turn's
   * permitted round trips.
   *
   * That last part is the whole contract, and it is NOT "the deltas
   * concatenate to the return value". With `maxTurns > 1` the model may say
   * something before it calls a tool — "Let me search the vault for that." —
   * and that sentence streams through here like any other text. What this
   * function returns is the `result` message: the FINAL assistant turn alone.
   * So in general the stream is a superset of the return value and ends with
   * it, and they are equal only when the model answered without narrating
   * first. Which of the two happens is the model's choice, turn by turn.
   *
   * The return value is therefore the authority. A caller that renders deltas
   * live must overwrite what it rendered with the returned string when the
   * call resolves (see `appendDelta` / `finishTurn` in
   * src/lib/chat-transcript.ts), or a preamble can be left sitting in front of
   * the answer.
   *
   * Setting this turns on `includePartialMessages`, which adds `stream_event`
   * messages carrying one Messages API streaming event each
   * (`SDKPartialAssistantMessage` in the installed sdk.d.ts). Only `text_delta`
   * is forwarded — `input_json_delta` (tool arguments) and `thinking_delta`
   * are deliberately dropped, since they are never shown.
   */
  onText?(delta: string): void;
  /**
   * Fires once, with the SDK session id of the turn that just completed, so a
   * multi-turn caller can pass it back as `resume`. Read from the `result`
   * message every time rather than assumed stable across a resume.
   */
  onSessionId?(id: string): void;
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
        persistSession: opts.persistSession ?? false,
        cwd: opts.cwd,
        settingSources: opts.settingSources,
        resume: opts.resume,
        includePartialMessages: opts.onText !== undefined,
        systemPrompt:
          opts.systemPromptAppend === undefined
            ? undefined
            : { type: "preset", preset: "claude_code", append: opts.systemPromptAppend },
      },
    })) {
      if (opts.onText !== undefined && message.type === "stream_event") {
        // One Messages API streaming event per message. Text arrives as
        // content_block_delta / text_delta; everything else is skipped.
        const event = message.event as {
          type?: unknown;
          delta?: { type?: unknown; text?: unknown };
        };
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta" &&
          typeof event.delta.text === "string"
        ) {
          opts.onText(event.delta.text);
        }
      }
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
        opts.onSessionId?.(message.session_id);
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
