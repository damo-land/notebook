// Demo/verification for the vault library. Run: npx tsx scripts/vault-demo.ts
// Exercises create / read / update / list against a temp dir and asserts that
// updateNote's append path leaves the original body bytes untouched.

import * as nodeFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert";
import {
  createNote,
  readNote,
  updateNote,
  listNotes,
  getVaultDir,
  type VaultFs,
} from "../src/lib/vault";

const fs: VaultFs = {
  readFile: (p) => nodeFs.readFile(p, "utf8"),
  writeFile: (p, data) => nodeFs.writeFile(p, data, "utf8"),
  readdir: (p) => nodeFs.readdir(p),
  mkdir: async (p) => {
    await nodeFs.mkdir(p, { recursive: true });
  },
};

async function main() {
  const vaultDir = await nodeFs.mkdtemp(path.join(os.tmpdir(), "stash-vault-"));
  console.log("vault dir:", vaultDir);

  // config resolution (against a fake home with no config -> default)
  const fakeHome = await nodeFs.mkdtemp(path.join(os.tmpdir(), "stash-home-"));
  assert.strictEqual(await getVaultDir(fs, fakeHome), `${fakeHome}/Stash`);
  await nodeFs.mkdir(`${fakeHome}/.config/stash`, { recursive: true });
  await nodeFs.writeFile(
    `${fakeHome}/.config/stash/config.json`,
    JSON.stringify({ vaultDir: "~/CustomVault" })
  );
  assert.strictEqual(await getVaultDir(fs, fakeHome), `${fakeHome}/CustomVault`);
  console.log("getVaultDir: default + config override OK");

  // create
  const note = await createNote(fs, vaultDir, {
    body: "# Grocery run\n\nMilk, eggs, coffee.\n",
    tags: ["errand", "home"],
  });
  console.log("created:", note.id);
  const task = await createNote(fs, vaultDir, {
    body: "# File taxes\n\nGather receipts first.\n",
    kind: "task",
    deadline: "2026-09-15",
    done: false,
    alert: "2026-09-10T09:00:00Z",
  });
  console.log("created:", task.id);

  // read
  const readBack = await readNote(fs, vaultDir, note.id);
  assert.strictEqual(readBack.body, note.body);
  assert.deepStrictEqual(readBack.frontmatter.tags, ["errand", "home"]);
  assert.strictEqual(readBack.frontmatter.kind, "note");
  assert.ok(!Number.isNaN(Date.parse(readBack.frontmatter.created)));
  const taskBack = await readNote(fs, vaultDir, task.id);
  assert.strictEqual(taskBack.frontmatter.kind, "task");
  assert.strictEqual(taskBack.frontmatter.deadline, "2026-09-15");
  assert.strictEqual(taskBack.frontmatter.done, false);
  assert.strictEqual(taskBack.frontmatter.alert, "2026-09-10T09:00:00Z");
  console.log("read: frontmatter + body round-trip OK");

  // update: append + set frontmatter must preserve original body bytes verbatim
  const rawBefore = await nodeFs.readFile(note.path, "utf8");
  const bodyBefore = rawBefore.slice(rawBefore.indexOf("\n---\n") + 5);
  await updateNote(fs, vaultDir, note.id, {
    appendBody: "\n## Later\n\nAlso bread.\n",
    setFrontmatter: { tags: ["errand", "home", "food"] },
  });
  const rawAfter = await nodeFs.readFile(note.path, "utf8");
  const bodyAfter = rawAfter.slice(rawAfter.indexOf("\n---\n") + 5);
  assert.ok(bodyAfter.startsWith(bodyBefore), "original body bytes not preserved");
  assert.ok(bodyAfter.endsWith("Also bread.\n"));
  assert.deepStrictEqual((await readNote(fs, vaultDir, note.id)).frontmatter.tags, [
    "errand",
    "home",
    "food",
  ]);
  console.log("update: append preserved original body bytes verbatim");

  // update: task completion
  const doneTask = await updateNote(fs, vaultDir, task.id, {
    setFrontmatter: { done: true },
  });
  assert.strictEqual(doneTask.frontmatter.done, true);
  console.log("update: task marked done");

  // foreign frontmatter lines survive round-trip through updateNote
  const foreign = rawAfter.replace("\n---\n", "\ncustom_field: kept by hand\n---\n");
  await nodeFs.writeFile(note.path, foreign, "utf8");
  await updateNote(fs, vaultDir, note.id, { appendBody: "\nOne more line.\n" });
  const rawForeign = await nodeFs.readFile(note.path, "utf8");
  assert.ok(rawForeign.includes("custom_field: kept by hand"));
  console.log("update: unknown frontmatter field survived round-trip");

  // list
  const listing = await listNotes(fs, vaultDir);
  assert.strictEqual(listing.length, 2);
  for (const n of listing) {
    console.log(`- ${n.id} [${n.frontmatter.kind}] "${n.firstLine}" tags=[${n.frontmatter.tags}]`);
  }

  // path clamp: full paths from listNotes resolve fine…
  const viaPath = await readNote(fs, vaultDir, listing[0].path);
  assert.strictEqual(viaPath.id, listing[0].id);
  // …but anything escaping the vault dir is rejected before any fs access
  for (const bad of ["/tmp/x.md", "../escape.md", `${vaultDir}/../escape.md`, "/etc/passwd"]) {
    await assert.rejects(readNote(fs, vaultDir, bad), /escapes vault dir/);
    await assert.rejects(
      updateNote(fs, vaultDir, bad, { appendBody: "x" }),
      /escapes vault dir/
    );
  }
  console.log("notePath clamp: vault paths allowed, escaping paths rejected");

  console.log("all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
