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
  role: "you" | "notebook";
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
