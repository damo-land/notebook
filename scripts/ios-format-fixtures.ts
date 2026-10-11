// Golden fixtures for the iOS app's note-format port (ios/StashCore).
// Run: npx tsx scripts/ios-format-fixtures.ts
//
// The TS vault library is the oracle: every case below is run through the real
// createNote / updateNote / parseNoteFile / serializeNoteFile and the exact
// output bytes are written to golden.json. The Swift tests re-run the same
// inputs and must reproduce those bytes. Re-run this script whenever
// src/lib/vault changes, and commit the regenerated golden.json.

process.env.TZ = "Europe/London"; // must precede any Date use

import * as nodeFs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createNote,
  updateNote,
  type CreateNoteInput,
  type UpdateNotePatch,
  type VaultFs,
} from "../src/lib/vault";
import { parseNoteFile, serializeNoteFile } from "../src/lib/vault/frontmatter";

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../ios/StashCore/Tests/StashCoreTests/Fixtures/golden.json"
);

/** In-memory VaultFs: a flat dir of name → contents. */
function memFs(files: Record<string, string>): VaultFs {
  return {
    readFile: async (p) => {
      const name = path.basename(p);
      if (!(name in files)) throw new Error(`ENOENT ${p}`);
      return files[name];
    },
    writeFile: async (p, data) => {
      files[path.basename(p)] = data;
    },
    readdir: async () => Object.keys(files),
    mkdir: async () => {},
  };
}

/** Runs `fn` with `new Date()` frozen at `iso`. */
async function atTime<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(iso);
      else super(...(args as [string]));
    }
    static now() {
      return new RealDate(iso).getTime();
    }
  }
  globalThis.Date = FrozenDate as DateConstructor;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

const createCases: { now: string; existing: string[]; input: CreateNoteInput }[] = [
  { now: "2026-10-09T21:24:36.704Z", existing: [], input: { body: "talk to Triss about an agency", kind: "task" } },
  { now: "2026-01-15T08:00:00.000Z", existing: [], input: { body: "Hello world" } },
  // Local (London, BST) date is the next day while UTC is still the 9th.
  { now: "2026-10-09T23:30:00.123Z", existing: [], input: { body: "midnight crossing", kind: "knowledge" } },
  {
    now: "2026-09-25T18:09:53.001Z",
    existing: [],
    input: { body: "test copilot agent for slides planning p\nsecond line", kind: "task", tags: ["work", "ai"], deadline: "2026-09-26" },
  },
  { now: "2026-03-01T12:00:00.000Z", existing: [], input: { body: "  --Hello, World!!--  ", kind: "note" } },
  { now: "2026-03-01T12:00:00.000Z", existing: [], input: { body: "a very long first line that will be cut exactly at forty characters - ok" } },
  { now: "2026-03-01T12:00:00.000Z", existing: [], input: { body: "abcdefghijklmnopqrstuvwxyz0123456789abc-defgh" } },
  { now: "2026-03-01T12:00:00.000Z", existing: [], input: { body: "🚀🎉" } },
  { now: "2026-03-01T12:00:00.000Z", existing: [], input: { body: "" } },
  { now: "2026-03-01T12:00:00.000Z", existing: [], input: { body: "\nbody starts on line two" } },
  { now: "2026-03-01T12:00:00.000Z", existing: [], input: { body: "Zażółć gęślą jaźń — Straße İstanbul Kelvin" } },
  { now: "2026-03-01T12:00:00.000Z", existing: [], input: { body: "東京 meeting @ 10:30 (re: Q4)" } },
  {
    now: "2026-03-01T12:00:00.000Z",
    existing: ["20260301-120000-dup.md", "20260301-120000-dup-2.md", "other.md"],
    input: { body: "dup" },
  },
  {
    now: "2026-07-04T06:05:04.999Z",
    existing: [],
    input: { body: "everything set\n\nwith a body\n", kind: "task", tags: [], deadline: "2026-07-10", done: false, alert: "2026-07-05T09:00:00Z" },
  },
  { now: "2026-07-04T06:05:04.000Z", existing: [], input: { body: "trailing newline\n", tags: ["a b", "c"] } },
];

const roundTripCases: string[] = [
  "---\nid: 20261009-222436-talk-to-triss-about-an-agency\ncreated: 2026-10-09T21:24:36.704Z\nkind: task\ntags: []\n---\ntalk to Triss about an agency",
  "---\nid: x\ncreated: 2026-01-01T00:00:00.000Z\nkind: knowledge\ntags: [ai, tools]\nenriched: 2026-01-01T00:03:00Z\nalerted: true\nsource: https://example.com/a?b=c\n---\nbody\n\n## Related\n- [[20260101-000000-other]]\n",
  "---\nkind: task\ndone: true\nid: out-of-order\ntags: [z]\ncreated: c\nzeta: 1\nalpha: 2\n---\nreordered",
  "---\nid: extra\n# a comment line\n  - indented list item\n\nnot a key line\n---\nextra lines",
  "plain text, no frontmatter",
  "---\r\nid: crlf\r\n---\r\nwindows",
  "---\nid: unclosed\nbody without closing",
  "---\n---\nempty block is not closed at index 4",
  "---\nid: trailing   \nkey:no-space\nkey2:  two spaces\nkey3:\ttab\nempty:\n---\nvalues",
  "---\ndup: first\nother: x\ndup: second\n---\nduplicate keys",
  "---\nl1: [a, , b]\nl2: [ ]\nl3: []\nl4: [ x ,y ]\nl5: [\nl6: ]\nl7: [single]\n---\nlists",
  "---\nb1: true\nb2: false\nb3: True\nb4: \"true\"\nb5:  true  \n---\nbools",
  "---\nid: u\n---\nZażółć 🚀 東京\n---\nsecond fence in body\n",
  "---\nnbsp: value\nfeff: ﻿v﻿\nnel: v\u0085\n---\nunicode whitespace",
  "---\ncr: b\r\ncr2:\r\nls: a b\nls2: \n---\nline terminators",
  "---\n1bad: x\n_ok: y\nkey-with-dash_9: z\nbad key: w\n---\nkey shapes",
  "---\nid: a\n---\n",
  "",
];

const updateCases: { file: string; patch: UpdateNotePatch }[] = [
  {
    file: "---\nid: t\ncreated: 2026-01-01T00:00:00.000Z\nkind: task\ntags: [work]\nalerted: true\nalert: 2026-01-02T09:00:00Z\n---\ndo the thing",
    patch: { setFrontmatter: { done: true } },
  },
  {
    file: "---\nid: t\ncreated: c\nkind: task\ntags: []\ndone: true\n---\nundo me",
    patch: { setFrontmatter: { done: undefined } },
  },
  {
    file: "---\nid: k\ncreated: c\nkind: knowledge\ntags: []\nenriched: 2026-01-01T00:03:00Z\n# keep me\n---\nold body",
    patch: { replaceBody: "new body\nline 2" },
  },
  {
    file: "plain text, no frontmatter",
    patch: { setFrontmatter: { done: true, zeta: "z", deadline: "2026-01-01" } },
  },
  {
    file: "---\nid: a\n---\nbody",
    patch: { setFrontmatter: { tags: ["x", "y"] }, appendBody: "\nappended" },
  },
];

async function main() {
  const create = [];
  for (const c of createCases) {
    const files: Record<string, string> = {};
    for (const name of c.existing) files[name] = "";
    const note = await atTime(c.now, () => createNote(memFs(files), "/vault", c.input));
    create.push({ now: c.now, existing: c.existing, input: c.input, id: note.id, file: files[`${note.id}.md`] });
  }

  const roundTrip = roundTripCases.map((input) => {
    const { fm, body } = parseNoteFile(input);
    return { input, output: serializeNoteFile(fm, body), body, keys: Object.keys(fm.data), extraLines: fm.extraLines };
  });

  const update = [];
  for (const c of updateCases) {
    const files: Record<string, string> = { "n.md": c.file };
    await updateNote(memFs(files), "/vault", "n", c.patch);
    // JSON drops `undefined`; encode "delete this key" as null for Swift.
    const setFrontmatter = c.patch.setFrontmatter
      ? Object.entries(c.patch.setFrontmatter).map(([k, v]) => [k, v === undefined ? null : v])
      : undefined;
    update.push({ file: c.file, patch: { ...c.patch, setFrontmatter }, output: files["n.md"] });
  }

  await nodeFs.mkdir(path.dirname(OUT), { recursive: true });
  await nodeFs.writeFile(OUT, JSON.stringify({ timeZone: process.env.TZ, create, roundTrip, update }, null, 2) + "\n");
  console.log(`wrote ${create.length} create, ${roundTrip.length} round-trip, ${update.length} update cases → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
