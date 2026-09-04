// Demo/verification for the /clear chat command (T3, chat-polish).
// Run: npx tsx scripts/chat-clear-demo.ts
//
// Proves the pure reset logic (src/lib/chat-transcript.ts) ChatView applies
// when `/clear` is submitted as the whole input:
//
//   * only the literal (trimmed) `/clear` is the command — trailing text is a
//     normal message;
//   * clearing empties the transcript AND drops the SDK session id, so the
//     next turn's request carries no session and replays no history — a brand
//     new SDK session;
//   * the cleared transcript feeds the existing restoreView contract
//     (src/lib/view-restore.ts) truthfully: after /clear, closing and
//     reopening the overlay lands on capture.

import assert from "node:assert";
import {
  clearConversation,
  historyFromTurns,
  isClearCommand,
  type ChatTurn,
} from "../src/lib/chat-transcript";
import { restoreView } from "../src/lib/view-restore";

// --- What counts as the command: the whole input, trimmed, nothing else. ---

assert.strictEqual(isClearCommand("/clear"), true);
assert.strictEqual(isClearCommand("  /clear  "), true, "trimmed match");
assert.strictEqual(isClearCommand("/clear the deck"), false, "trailing text is a normal message");
assert.strictEqual(isClearCommand("/clearx"), false);
assert.strictEqual(isClearCommand("clear"), false);
assert.strictEqual(isClearCommand(""), false);

// --- Clearing empties turns and drops the session id. ---

const before = {
  turns: [
    { role: "you", text: "what did I note about tauri?" },
    { role: "stash", text: "You noted the overlay hides on resign-key." },
  ] as ChatTurn[],
  session: "sdk-session-abc123" as string | null,
};

const cleared = clearConversation(before);
assert.deepStrictEqual(cleared.turns, [], "transcript emptied");
assert.strictEqual(cleared.session, null, "stored SDK session id dropped");
// Pure: the input conversation is untouched.
assert.strictEqual(before.turns.length, 2);
assert.strictEqual(before.session, "sdk-session-abc123");

// --- The next turn after /clear starts a new SDK session. ---
//
// ChatView builds each chat_send request from exactly these two pieces of
// state: `session` goes up verbatim, `history` is historyFromTurns(turns).
// From a cleared conversation both are empty — no session/resume, no replayed
// history, so the sidecar starts a fresh SDK session.

assert.strictEqual(cleared.session, null, "next-turn request carries no session id");
assert.deepStrictEqual(historyFromTurns(cleared.turns), [], "no pending history replayed");

// Sanity: before the clear the very same derivation DID thread context.
assert.strictEqual(historyFromTurns(before.turns).length, 2);

// historyFromTurns mirrors what may be mid-flight: streaming and empty turns
// are never part of the replayed history.
const midFlight: ChatTurn[] = [
  { role: "you", text: "hi" },
  { role: "stash", text: "partial…", streaming: true },
];
assert.deepStrictEqual(historyFromTurns(midFlight), [{ role: "user", content: "hi" }]);

// --- After /clear, the next overlay open lands on capture. ---
//
// The existing restoreView contract (asserted end to end in
// scripts/view-restore-demo.ts): transcriptEmpty → "capture". The cleared
// conversation signals transcriptEmpty truthfully.

assert.strictEqual(restoreView({ transcriptEmpty: cleared.turns.length === 0 }), "capture");

console.log("chat-clear demo: all assertions passed");
