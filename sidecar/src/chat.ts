// Chat turn (T14): one message from the overlay's chat view, answered by the
// Agent SDK with the vault as its working directory so the reply can cite real
// notes.
//
// Deliberately stateless. The sidecar holds no transcript: each turn carries
// the SDK session id of the previous one and gets the (possibly new) id back,
// so continuity is the SDK's own `resume`, and the human-readable transcript
// lives only in the frontend's React state for the length of the session.
// Nothing here writes anything, to the vault or anywhere else.
import { runPrompt, type RunPromptOptions } from "./llm.ts";

/**
 * Built-in tools a chat turn may use. Read-only by construction: no Write, no
 * Edit, no Bash, no WebFetch. `Options.tools` is what RESTRICTS the available
 * set (the SDK's own doc: "To restrict which tools are available, use the
 * `tools` option instead"), and `allowedTools` is what auto-approves them —
 * a tool in `tools` but not in `allowedTools` stalls in this non-interactive
 * process, so chat lists the same three in both.
 */
export const CHAT_TOOLS = ["Read", "Glob", "Grep"];

/**
 * Turn budget. Must be well above 1: a Grep to find the notes and a Read to
 * quote them are two round trips before the model can even start answering.
 */
export const CHAT_MAX_TURNS = 8;

/**
 * Format and grounding instruction, appended to the Claude Code preset system
 * prompt. Note what is NOT here: no name, no character, no voice, no
 * persistent "about the user" text. Persona is a recorded v1 non-goal; this
 * string exists to make answers short and to make them cite note ids.
 */
export const CHAT_SYSTEM_APPEND =
  "You are answering questions about the user's personal notes vault, which is your " +
  "working directory. The notes are markdown files with a YAML frontmatter block " +
  "containing `id`, `created`, `kind` and optional `tags`. Search the vault with Grep " +
  "and Glob and read the matches with Read before you answer — never answer from " +
  "memory. Cite the id of every note you used. Keep answers short and plain; no " +
  "preamble, no sign-off. If nothing in the vault matches, say so.";

export interface ChatTurnParams {
  /** Vault directory. Becomes the session's working directory. */
  vaultDir: string;
  /** The user's message. */
  text: string;
  /** SDK session id from the previous turn, when continuing a conversation. */
  session?: string;
}

export interface ChatTurnResult {
  /** The assistant's answer. */
  text: string;
  /** SDK session id to send back as `session` on the next turn. */
  session: string | null;
}

export interface ChatDeps {
  runPrompt(text: string, opts?: RunPromptOptions): Promise<string>;
}

/**
 * The exact SDK options a chat turn runs with. Exported so the proof script
 * can assert the vault scoping and the read-only tool set without spending a
 * prompt.
 *
 * Scoping, concretely: `cwd` is the vault, no `additionalDirectories` widens
 * that, the tool set contains nothing that can write, and `settingSources: []`
 * stops the CLI loading a `CLAUDE.md` or `.claude/settings.json` that happened
 * to be sitting in the vault (a notes directory is user content, not a
 * project, and must not be able to steer the agent or widen its permissions).
 */
export function chatPromptOptions(vaultDir: string, session?: string): RunPromptOptions {
  return {
    cwd: vaultDir,
    tools: CHAT_TOOLS,
    allowedTools: CHAT_TOOLS,
    maxTurns: CHAT_MAX_TURNS,
    systemPromptAppend: CHAT_SYSTEM_APPEND,
    settingSources: [],
    // Session continuity is the SDK's own: the transcript goes to
    // ~/.claude/projects/ (NOT the vault) and `resume` loads it next turn.
    persistSession: true,
    ...(session === undefined || session === "" ? {} : { resume: session }),
  };
}

/**
 * One chat turn.
 *
 * `onText` receives the turn's assistant text in streaming deltas — all of it,
 * including anything the model says before it calls Grep or Read. The
 * returned `text` is the final assistant turn alone and is what the caller
 * must display; the stream is a preview of it, not a transcript of it. See
 * `RunPromptOptions.onText`.
 */
export async function chatTurn(
  params: ChatTurnParams,
  deps: ChatDeps,
  hooks: { onText?(delta: string): void } = {},
): Promise<ChatTurnResult> {
  if (params.text.trim() === "") {
    throw new Error("chat requires a non-empty message");
  }
  // Re-read from every turn rather than assuming the id survives a resume.
  let session: string | null = params.session ?? null;
  const text = await deps.runPrompt(params.text, {
    ...chatPromptOptions(params.vaultDir, params.session),
    onSessionId: (id) => {
      session = id;
    },
    ...(hooks.onText === undefined ? {} : { onText: hooks.onText }),
  });
  return { text, session };
}

/** Production dependencies: the real SDK call. */
export const chatDeps: ChatDeps = { runPrompt };
