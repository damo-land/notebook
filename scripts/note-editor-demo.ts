// Round-trip proof for the note editor (T7). Run: npx tsx scripts/note-editor-demo.ts
// Creates a note with full frontmatter, simulates the editor's open + save
// (readNote, then updateNote with replaceBody — exactly what App.saveEdit
// does), re-reads, and asserts frontmatter keys AND values are identical
// while the body was updated.

import * as nodeFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert";
import { createNote, readNote, updateNote, type VaultFs } from "../src/lib/vault";

const fs: VaultFs = {
  readFile: (p) => nodeFs.readFile(p, "utf8"),
  writeFile: (p, data) => nodeFs.writeFile(p, data, "utf8"),
  readdir: (p) => nodeFs.readdir(p),
  mkdir: async (p) => {
    await nodeFs.mkdir(p, { recursive: true });
  },
};

async function main() {
  const vaultDir = await nodeFs.mkdtemp(path.join(os.tmpdir(), "stash-editor-"));
  console.log("vault dir:", vaultDir);

  // Note with every frontmatter field the editor must not disturb.
  const created = await createNote(fs, vaultDir, {
    body: "# Ship the release\n\nDraft the changelog.\n",
    kind: "task",
    tags: ["work", "release"],
    deadline: "2026-09-15",
    alert: "2026-09-10T09:00:00Z",
    done: false,
  });
  console.log("created:", created.id);

  // Editor "open": read by id — this is what the overlay shows.
  const opened = await readNote(fs, vaultDir, created.id);
  const fmBefore = structuredClone(opened.frontmatter);
  assert.strictEqual(opened.body, created.body);

  // Editor "save": user edited the body, Enter/Cmd+S -> replaceBody.
  const newBody = "# Ship the release\n\nDraft the changelog.\n\nAlso tag the repo.\n";
  await updateNote(fs, vaultDir, opened.id, { replaceBody: newBody });

  // Re-read and diff frontmatter before/after.
  const after = await readNote(fs, vaultDir, created.id);
  const keysBefore = Object.keys(fmBefore).sort();
  const keysAfter = Object.keys(after.frontmatter).sort();
  assert.deepStrictEqual(keysAfter, keysBefore, "frontmatter keys changed across edit");
  assert.deepStrictEqual(after.frontmatter, fmBefore, "frontmatter values changed across edit");
  assert.strictEqual(after.body, newBody, "body was not updated");
  assert.notStrictEqual(after.body, created.body);
  console.log("frontmatter keys before/after:", keysBefore.join(", "));
  console.log("round-trip: frontmatter identical, body updated");

  console.log("all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
