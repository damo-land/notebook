// Demo/verification for the T3 view-restore rule. Run: npx tsx scripts/view-restore-demo.ts
//
// Proves the pure rule (src/lib/view-restore.ts) App applies in its
// overlay-hidden reset: an empty chat transcript means the next open starts
// in capture (today's behaviour), a non-empty one means it resumes in chat.

import assert from "node:assert";
import { restoreView } from "../src/lib/view-restore";

// Empty transcript: the next open is plain capture, exactly as before T3.
assert.strictEqual(restoreView({ transcriptEmpty: true }), "capture");

// Non-empty transcript: the next open resumes the conversation.
assert.strictEqual(restoreView({ transcriptEmpty: false }), "chat");

console.log("view-restore demo: all assertions passed");
