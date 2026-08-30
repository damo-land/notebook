// Demo/verification for the T2 inline "/" action menu logic.
// Run: npx tsx scripts/inline-slash-demo.ts
//
// Proves the pure half of the open/close rule (src/lib/inline-slash.ts):
// query extraction between the typed "/" and the caret, prefix matching,
// the no-match/whitespace/deleted-slash cases that hide or break the menu,
// and the exact removal of the "/query" span when an action is applied.
// The DOM half of the rule — the menu opens only on a "/" KEYDOWN, so a
// paste (which fires no keydown) never opens it — lives in App.tsx.

import assert from "node:assert";
import { inlineQuery, matchActions, removeQuery } from "../src/lib/inline-slash";

const TASK_ACTIONS = [{ label: "deadline" }, { label: "category" }, { label: "alert" }];
const PLAIN_ACTIONS = [
  { label: "task" },
  { label: "knowledge" },
  { label: "search" },
  { label: "chat" },
  { label: "alert" },
];

// Mid-line trigger + filtering: `Buy robot /dea|` — "/" typed at 10, caret 14.
assert.equal(inlineQuery("Buy robot /dea", 10, 14), "dea");
assert.deepEqual(
  matchActions(TASK_ACTIONS, "dea").map((a) => a.label),
  ["deadline"]
);

// Empty query right after the "/" matches every action (menu fully open).
assert.equal(inlineQuery("Buy robot /", 10, 11), "");
assert.equal(matchActions(TASK_ACTIONS, "").length, 3);
assert.equal(matchActions(PLAIN_ACTIONS, "").length, 5);

// No-match: `/data` in task mode matches nothing — the menu is hidden and
// nothing rewrites the body, so the saved note contains the literal text.
assert.equal(inlineQuery("Buy robot /data", 10, 15), "data");
assert.equal(matchActions(TASK_ACTIONS, "data").length, 0);

// Filtering is case-insensitive on the query side.
assert.equal(inlineQuery("x /DEA", 2, 6), "dea");

// Whitespace breaks the query (a "/word " is prose): null → menu closed.
assert.equal(inlineQuery("Buy robot /de a", 10, 15), null);
assert.equal(inlineQuery("a /de\nb", 2, 7), null);

// The "/" deleted, or the caret leaving the span, breaks the query too.
assert.equal(inlineQuery("Buy robot dea", 10, 13), null);
assert.equal(inlineQuery("Buy robot /dea", 10, 9), null);
assert.equal(inlineQuery("Buy robot /dea", 10, 10), null);

// A URL typed char-by-char: after "https:/" the second "/" makes the query
// "/" which matches no action — menu hidden, text literal.
assert.equal(inlineQuery("https://", 6, 8), "/");
assert.equal(matchActions(PLAIN_ACTIONS, "/").length, 0);

// Applying an action removes exactly the "/query" span, nothing else.
assert.equal(removeQuery("Buy robot /dea", 10, 14), "Buy robot ");
assert.equal(removeQuery("call /al soon", 5, 8), "call  soon");
assert.equal(removeQuery("/ta", 0, 3), "");

console.log("inline-slash-demo: all assertions passed");
