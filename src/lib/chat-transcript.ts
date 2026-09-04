// The two transcript reducers behind the chat view's streaming (T14).
//
// They live here, apart from the React component, because they encode the
// load-bearing half of the streaming contract and that contract has to be
// provable without a DOM:
//
//   * `appendDelta` shows the stream as it arrives. What arrives is EVERY
//     assistant text delta the model emits across all of a turn's permitted
//     round trips — including anything it says before reaching for Grep or
//     Read. So mid-flight this text can legitimately contain more than the
//     answer.
//   * `finishTurn` then overwrites it with the string the sidecar returned,
//     which is the final assistant turn alone and is authoritative. That
//     overwrite is what makes any narration transient: whatever the stream
//     showed, what the user is left looking at is exactly the returned answer.
//
// Pure, dependency-free and no DOM types on purpose — `sidecar/scripts/
// chat-demo.ts` imports this module so the proof can drive stream -> view ->
// final render end to end.

export interface ChatTurn {
  role: "you" | "stash";
  text: string;
  /** True while this answer is still streaming in. */
  streaming?: boolean;
}

/**
 * Append one streamed delta to the answer currently being written. Turns that
 * are already finished are never touched, and no turn is ever added: a delta
 * that arrives when nothing is streaming is dropped.
 */
export function appendDelta(turns: ChatTurn[], delta: string): ChatTurn[] {
  const last = turns[turns.length - 1];
  if (last === undefined || last.streaming !== true) return turns;
  return [...turns.slice(0, -1), { ...last, text: last.text + delta }];
}

/**
 * Replace the in-progress answer with its final text (or an error note) and
 * clear the streaming flag. Also repairs a partial stream — deltas missed
 * while the view was unmounted, or narration that was never part of the
 * answer — because `text`, not the accumulated stream, is the authority.
 */
export function finishTurn(turns: ChatTurn[], text: string): ChatTurn[] {
  const last = turns[turns.length - 1];
  if (last === undefined || last.streaming !== true) return turns;
  return [...turns.slice(0, -1), { role: last.role, text }];
}

// --- /clear (chat-polish T3) -----------------------------------------------
//
// The chat input recognises exactly one command: the literal `/clear`,
// submitted as the whole input. It resets the conversation — transcript
// emptied, SDK session id dropped — so the next message starts a brand new
// SDK session (chat_send goes up with `session: null` and an empty history).
// The reset lives here, pure, so scripts/chat-clear-demo.ts can prove both
// halves without a DOM.

/** The one recognised chat command. */
export const CLEAR_COMMAND = "/clear";

/**
 * True when the submitted input is the /clear command: the trimmed input is
 * exactly `/clear`, nothing more. `/clear` with trailing text is NOT the
 * command — it goes to the model as a normal message.
 */
export function isClearCommand(input: string): boolean {
  return input.trim() === CLEAR_COMMAND;
}

/** The conversation state ChatView threads into every chat_send request. */
export interface ChatConversation {
  turns: ChatTurn[];
  /** SDK session id of the conversation so far; null before the first turn. */
  session: string | null;
}

/**
 * The whole /clear reset: transcript emptied, session id dropped. Everything
 * a chat_send request is built from comes out empty, so the turn after a
 * clear carries no session to resume and no history to replay.
 */
export function clearConversation(_conversation: ChatConversation): ChatConversation {
  return { turns: [], session: null };
}

/**
 * The history replayed to the sidecar on each turn, derived from the
 * transcript as it stood BEFORE the new turn's rows are appended: finished,
 * non-empty turns only — a still-streaming answer or an error-emptied row is
 * never part of the context. (The ollama provider has no server-side session,
 * so this replay IS its continuity; the claude path uses `session` instead
 * and ignores it.)
 */
export function historyFromTurns(turns: ChatTurn[]): { role: string; content: string }[] {
  return turns
    .filter((t) => t.streaming !== true && t.text !== "")
    .map((t) => ({ role: t.role === "you" ? "user" : "assistant", content: t.text }));
}
