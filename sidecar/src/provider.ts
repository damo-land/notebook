// The provider seam (T2): EVERY LLM call the sidecar makes resolves through
// this module. main.ts coerces the `llm` params sent per-request by the Rust
// side (which reads ~/.config/stash/config.json fresh on each call, so a
// settings change applies without a restart) and routes:
//
//   provider "claude" -> llm.ts runPrompt (the Agent SDK), with the model
//                        resolved by the precedence documented on
//                        resolveClaudeModel below;
//   provider "ollama" -> ollama.ts (chat is real as of T3 — tool loop with
//                        RAG-lite fallback; the prompt shape is still a typed
//                        not-implemented stub).
//
// Deliberately not a plugin architecture: two providers, one if/else.
import { chatTurn, type ChatTurnParams, type ChatTurnResult } from "./chat.ts";
import { runPrompt, type RunPromptOptions } from "./llm.ts";
import { ollamaChat, ollamaPrompt } from "./ollama.ts";

export type LlmProviderId = "claude" | "ollama";

export interface LlmConfig {
  provider: LlmProviderId;
  model: string;
}

/**
 * What an absent `llm` config means. Mirrors the Rust side
 * (src-tauri/src/llm_config.rs) — keep the two in sync, and keep the model in
 * sync with CLAUDE_MODELS in src/lib/llm-models.ts.
 */
export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: "claude",
  model: "claude-haiku-4-5",
};

/**
 * Tolerant coercion of the `llm` request params into a usable config: an
 * absent/malformed object or an unknown provider falls back to the claude
 * default; a blank model becomes the claude default under claude and stays
 * empty under ollama (no meaningful default exists until T3 can ask the
 * daemon what is installed).
 */
export function coerceLlmConfig(value: unknown): LlmConfig {
  const v = value as { provider?: unknown; model?: unknown } | null | undefined;
  const provider: LlmProviderId = v?.provider === "ollama" ? "ollama" : "claude";
  const model =
    typeof v?.model === "string" && v.model.trim() !== ""
      ? v.model.trim()
      : provider === "claude"
        ? DEFAULT_LLM_CONFIG.model
        : "";
  return { provider, model };
}

/**
 * The model a claude-provider call runs with. Precedence, most specific
 * first:
 *
 *   1. explicit per-call `opts.model` (existing callers keep their override)
 *   2. `STASH_MODEL` env var — the pre-config dev override, kept: it still
 *      wins over the configured model
 *   3. config `llm.model`
 *   4. the default, `claude-haiku-4-5`
 *
 * Blank strings count as unset at every level, so an exported-but-empty
 * STASH_MODEL can't silently shadow the configured model.
 */
export function resolveClaudeModel(
  explicit: string | undefined,
  configured: string,
): string {
  if (explicit !== undefined && explicit.trim() !== "") return explicit;
  const env = process.env["STASH_MODEL"];
  if (env !== undefined && env.trim() !== "") return env;
  if (configured.trim() !== "") return configured;
  return DEFAULT_LLM_CONFIG.model;
}

/**
 * The prompt-shaped seam: a `runPrompt`-compatible function bound to
 * `config`. Drop-in for ChatDeps.runPrompt / EnrichDeps.runPrompt, so every
 * existing call site goes through the provider by injection rather than by
 * rewrite.
 */
export function providerRunPrompt(
  config: LlmConfig,
): (text: string, opts?: RunPromptOptions) => Promise<string> {
  if (config.provider === "ollama") {
    return (text, opts = {}) => ollamaPrompt(text, opts);
  }
  return (text, opts = {}) =>
    runPrompt(text, { ...opts, model: resolveClaudeModel(opts.model, config.model) });
}

/** The chat-shaped seam: one chat turn on whichever provider is configured. */
export async function providerChatTurn(
  config: LlmConfig,
  params: ChatTurnParams,
  hooks: { onText?(delta: string): void } = {},
): Promise<ChatTurnResult> {
  // Ollama gets the configured model verbatim (a blank one is its typed
  // "pick a model in Settings" error, not a default).
  if (config.provider === "ollama") return ollamaChat(config.model, params, hooks);
  return chatTurn(params, { runPrompt: providerRunPrompt(config) }, hooks);
}
