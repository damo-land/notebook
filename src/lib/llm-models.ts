// Curated Claude model list (T2). THE one exported constant the settings UI
// (T5) renders as the model picker for the claude provider — add or retire
// models here and nowhere else. Ollama models are not listed here: they come
// live from the `ollama_status` command's `models` field.
//
// The first entry is the default the app uses when config.json has no `llm`
// object; keep it in sync with DEFAULT_LLM_CONFIG in sidecar/src/provider.ts
// and DEFAULT_CLAUDE_MODEL in src-tauri/src/llm_config.rs.

export const CLAUDE_MODELS = [
  "claude-haiku-4-5",
  "claude-sonnet-5",
  "claude-opus-5",
] as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number];

/** What an unconfigured install runs on: fast and cheap. */
export const DEFAULT_CLAUDE_MODEL: ClaudeModelId = CLAUDE_MODELS[0];
