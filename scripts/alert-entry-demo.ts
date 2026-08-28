// Demo/verification for the alert datetime parser (T9) and for the shape of
// the `alerted: true` marker the Rust scheduler writes back into a note.
// Run: npx tsx scripts/alert-entry-demo.ts
//
// All cases use a fixed "now" (Thu 2026-08-27, local). Expected values are
// built from local wall-clock fields so the assertions hold in any timezone —
// the parser's contract is "local wall clock in, UTC ISO out".

import assert from "node:assert";
import { parseDateTimeEntry } from "../src/lib/date-entry";
import { parseNoteFile, serializeNoteFile } from "../src/lib/vault/frontmatter";

const now = new Date(2026, 7, 27, 16, 40); // Thursday, 2026-08-27 16:40 local
assert.strictEqual(now.getDay(), 4, "fixture sanity: 2026-08-27 is a Thursday");

/** Expected UTC ISO for a local wall-clock datetime. */
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi, 0, 0).toISOString().replace(/\.\d{3}Z$/, "Z");

const cases: Array<[string, string | null]> = [
  // date + time
  ["fri 9am", at(2026, 8, 28, 9, 0)],
  ["friday 9:30pm", at(2026, 8, 28, 21, 30)],
  ["tomorrow 14:30", at(2026, 8, 28, 14, 30)],
  ["+1d 08:00", at(2026, 8, 28, 8, 0)],
  ["2026-09-03 9:30pm", at(2026, 9, 3, 21, 30)],
  ["today 23:59", at(2026, 8, 27, 23, 59)],
  ["thu 12am", at(2026, 9, 3, 0, 0)], // 12am = midnight, weekday rolls a week
  ["mon 12pm", at(2026, 8, 31, 12, 0)], // 12pm = noon
  ["fri 9 pm", at(2026, 8, 28, 21, 0)], // detached am/pm
  ["  TOMORROW  9AM ", at(2026, 8, 28, 9, 0)], // case + whitespace tolerant
  // bare time -> today, no roll-forward (16:00 is in the past for this `now`)
  ["18:00", at(2026, 8, 27, 18, 0)],
  ["9am", at(2026, 8, 27, 9, 0)],
  ["0:05", at(2026, 8, 27, 0, 5)],
  // date only -> default 09:00
  ["fri", at(2026, 8, 28, 9, 0)],
  ["+3d", at(2026, 8, 30, 9, 0)],
  ["2026-09-03", at(2026, 9, 3, 9, 0)],
  // rejections
  ["25:00", null], // hour out of range
  ["9:60", null], // minute out of range
  ["13pm", null], // 12-hour clock only
  ["0am", null],
  ["fri 9", null], // bare number is ambiguous
  ["9", null],
  ["fri 9am extra", null], // more than two tokens
  ["2026-02-30 9am", null], // impossible date
  ["blah 9am", null],
  ["", null],
];

for (const [input, expected] of cases) {
  const got = parseDateTimeEntry(input, now);
  assert.strictEqual(
    got,
    expected,
    `parseDateTimeEntry(${JSON.stringify(input)}) = ${got}, want ${expected}`
  );
  console.log(`${JSON.stringify(input).padEnd(22)} -> ${got}`);
}

// Output shape: fixed-width UTC ISO to the second, so the index's
// `alert <= now` string compare is chronological against the Rust "now".
const shaped = parseDateTimeEntry("2026-09-03 14:30", now);
assert.match(shaped!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, `bad shape: ${shaped}`);

// Round-trip the other way: the emitted instant really is that local wall clock.
const back = new Date(shaped!);
assert.strictEqual(back.getFullYear(), 2026);
assert.strictEqual(back.getMonth(), 8); // September
assert.strictEqual(back.getDate(), 3);
assert.strictEqual(back.getHours(), 14);
assert.strictEqual(back.getMinutes(), 30);
assert.strictEqual(back.getSeconds(), 0);
console.log(`round-trip: ${shaped} -> local ${back.toString()}`);

// The alerted marker the Rust scheduler writes (src-tauri/src/alerts.rs) must
// stay readable by the TS parser. This is the exact byte shape it emits:
// `alerted: true` appended as the last key line before the closing `---`.
const marked =
  "---\n" +
  "id: 20260827-164000-standup\n" +
  "created: 2026-08-27T16:40:00.000Z\n" +
  "kind: note\n" +
  "tags: []\n" +
  "alert: 2026-08-28T07:00:00Z\n" +
  "alerted: true\n" +
  "---\n" +
  "Standup reminder\n\nsecond paragraph\n";

const parsed = parseNoteFile(marked);
assert.strictEqual(parsed.fm.data.alerted, true, "alerted parses as boolean true");
assert.strictEqual(parsed.fm.data.alert, "2026-08-28T07:00:00Z");
assert.strictEqual(parsed.body, "Standup reminder\n\nsecond paragraph\n", "body untouched");
assert.deepStrictEqual(parsed.fm.extraLines, [], "marker is a key line, not junk");
assert.strictEqual(
  serializeNoteFile(parsed.fm, parsed.body),
  marked,
  "marked note round-trips byte-for-byte through the TS serializer"
);
console.log("alerted marker: parses + round-trips through the TS frontmatter layer");

console.log("all alert-entry checks passed");
