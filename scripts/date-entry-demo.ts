// Demo/verification for the date-entry parser. Run: npx tsx scripts/date-entry-demo.ts
// All cases use a fixed "now" (Thu 2026-08-27) so the assertions are exact.

import assert from "node:assert";
import { parseDateEntry } from "../src/lib/date-entry";

const now = new Date(2026, 7, 27); // Thursday, 2026-08-27
assert.strictEqual(now.getDay(), 4, "fixture sanity: 2026-08-27 is a Thursday");

const cases: Array<[string, string | null]> = [
  // ISO
  ["2026-09-03", "2026-09-03"],
  [" 2026-12-01 ", "2026-12-01"],
  ["2026-02-30", null], // impossible date rejected
  ["2026-13-01", null],
  // +Nd
  ["+3d", "2026-08-30"],
  ["+0d", "2026-08-27"],
  ["+10d", "2026-09-06"], // rolls over the month boundary
  ["+d", null],
  // weekday names -> next occurrence, strictly after today
  ["fri", "2026-08-28"],
  ["Friday", "2026-08-28"],
  ["mon", "2026-08-31"],
  ["thu", "2026-09-03"], // today is Thursday -> next week
  ["sunday", "2026-08-30"],
  // today / tomorrow
  ["today", "2026-08-27"],
  ["tomorrow", "2026-08-28"],
  // garbage
  ["blah", null],
  ["", null],
  ["frid", null], // only 3-letter prefix or full name
];

for (const [input, expected] of cases) {
  const got = parseDateEntry(input, now);
  assert.strictEqual(got, expected, `parseDateEntry(${JSON.stringify(input)}) = ${got}, want ${expected}`);
  console.log(`${JSON.stringify(input).padEnd(14)} -> ${got}`);
}

console.log("all date-entry checks passed");
