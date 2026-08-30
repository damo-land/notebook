// Demo/verification for the T8 tasks view logic. Run: npx tsx scripts/tasks-view-demo.ts
//
// Proves (1) the exact code path Space uses — updateNote(..., {setFrontmatter:
// {done: true}}) — flips `done` in the file's frontmatter on disk, including
// for tasks captured without a `done` field; (2) the pure list helpers
// (src/lib/task-list.ts): open-task filter, deadline-asc/nulls-last sort,
// category derivation and Tab cycling.

import * as nodeFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert";
import { createNote, updateNote, type VaultFs } from "../src/lib/vault";
import type { IndexedNote } from "../src/lib/index-api";
import {
  ALL_CATEGORIES,
  categoriesOf,
  cycleCategory,
  filterByCategory,
  openTasks,
  sortByDeadline,
} from "../src/lib/task-list";

const fs: VaultFs = {
  readFile: (p) => nodeFs.readFile(p, "utf8"),
  writeFile: (p, data) => nodeFs.writeFile(p, data, "utf8"),
  readdir: (p) => nodeFs.readdir(p),
  mkdir: async (p) => {
    await nodeFs.mkdir(p, { recursive: true });
  },
};

function row(over: Partial<IndexedNote> & { id: string }): IndexedNote {
  return {
    path: `${over.id}.md`,
    kind: "task",
    created: "2026-08-28T10:00:00.000Z",
    title: over.id,
    done: null,
    deadline: null,
    alert: null,
    tags: [],
    ...over,
  };
}

async function main() {
  // --- done toggle on disk (the Space handler's code path) -------------------
  const vaultDir = await nodeFs.mkdtemp(path.join(os.tmpdir(), "stash-tasks-"));
  console.log("vault dir:", vaultDir);

  // A task with an explicit done: false…
  const explicit = await createNote(fs, vaultDir, {
    body: "# Pay invoice\n",
    kind: "task",
    deadline: "2026-09-01",
    done: false,
  });
  assert.ok((await nodeFs.readFile(explicit.path, "utf8")).includes("done: false"));
  await updateNote(fs, vaultDir, explicit.id, { setFrontmatter: { done: true } });
  const rawExplicit = await nodeFs.readFile(explicit.path, "utf8");
  assert.ok(rawExplicit.includes("done: true"), "done: true not written to disk");
  assert.ok(!rawExplicit.includes("done: false"));
  assert.ok(rawExplicit.includes("# Pay invoice"), "body lost");
  console.log("toggle: done: false -> done: true rewritten in frontmatter on disk");

  // …and one captured without a done field at all (the quick-capture shape).
  const bare = await createNote(fs, vaultDir, { body: "# Call plumber\n", kind: "task" });
  assert.ok(!(await nodeFs.readFile(bare.path, "utf8")).includes("done:"));
  await updateNote(fs, vaultDir, bare.id, { setFrontmatter: { done: true } });
  assert.ok((await nodeFs.readFile(bare.path, "utf8")).includes("done: true"));
  console.log("toggle: done: true added to a task captured without a done field");

  // --- list helpers ----------------------------------------------------------
  const rows = [
    row({ id: "no-deadline-old", created: "2026-08-20T08:00:00.000Z" }),
    row({ id: "done-task", done: true, deadline: "2026-08-01", tags: ["work"] }),
    row({ id: "late", deadline: "2026-09-15", tags: ["home"] }),
    row({ id: "soon", deadline: "2026-08-30", done: false, tags: ["work"] }),
    row({ id: "no-deadline-new", created: "2026-08-27T08:00:00.000Z", tags: ["home"] }),
  ];

  // openTasks: done !== true (null counts as open — quick capture writes no done)
  const open = openTasks(rows);
  assert.deepStrictEqual(
    open.map((t) => t.id).sort(),
    ["late", "no-deadline-new", "no-deadline-old", "soon"]
  );

  // deadline asc, no-deadline last (created asc among those)
  assert.deepStrictEqual(
    sortByDeadline(open).map((t) => t.id),
    ["soon", "late", "no-deadline-old", "no-deadline-new"]
  );
  console.log("sort: deadline ascending, no-deadline last");

  // categories: "all" + tags on the given (open) tasks
  const cats = categoriesOf(open);
  assert.deepStrictEqual(cats, [ALL_CATEGORIES, "home", "work"]);

  // Tab cycle wraps; a stale persisted tag falls back to "all"
  assert.strictEqual(cycleCategory(cats, "all"), "home");
  assert.strictEqual(cycleCategory(cats, "home"), "work");
  assert.strictEqual(cycleCategory(cats, "work"), "all");
  assert.strictEqual(cycleCategory(cats, "work", -1), "home");
  assert.strictEqual(cycleCategory(cats, "gone-tag"), "all");
  console.log("filter: category cycle wraps, stale persisted tag -> all");

  // filter narrows; "all" is identity
  assert.strictEqual(filterByCategory(open, ALL_CATEGORIES).length, 4);
  assert.deepStrictEqual(
    filterByCategory(sortByDeadline(open), "home").map((t) => t.id),
    ["late", "no-deadline-new"]
  );
  console.log("filter: tag filter narrows the sorted list");

  console.log("all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
