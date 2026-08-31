// Vault helpers for the ollama chat tools (T3): keyword search + single-note
// read over a real (temp) directory of markdown notes.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readVaultNote, searchVault } from "./vault.ts";

async function makeVault(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "stash-vault-test-"));
  await writeFile(
    join(dir, "20260101-000000-sourdough.md"),
    "---\nid: 20260101-000000-sourdough\nkind: knowledge\ntags: [baking]\n---\nSourdough starter log\n\nDay 9: Kevin doubled in 5h at 24C. Feed ratio 1:2:2.\n",
  );
  await writeFile(
    join(dir, "20260102-000000-tires.md"),
    "---\nid: 20260102-000000-tires\nkind: note\n---\nWinter tires\n\nSwap winter tires in November.\n",
  );
  await writeFile(join(dir, "not-a-note.txt"), "ignored");
  return dir;
}

test("searchVault: keyword match returns id, title and a matching snippet", async () => {
  const dir = await makeVault();
  try {
    const hits = await searchVault(dir, "what about my sourdough starter?");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.id, "20260101-000000-sourdough");
    assert.equal(hits[0]!.title, "Sourdough starter log");
    assert.ok(hits[0]!.snippet.toLowerCase().includes("sourdough") || hits[0]!.snippet.includes("Kevin"));

    // No match -> empty, not a throw.
    assert.deepEqual(await searchVault(dir, "quantum chromodynamics"), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readVaultNote: by id and by path; escapes are rejected; missing is friendly", async () => {
  const dir = await makeVault();
  try {
    const byId = await readVaultNote(dir, "20260102-000000-tires");
    assert.ok(byId.body.includes("Winter tires"));
    const byPath = await readVaultNote(dir, "20260102-000000-tires.md");
    assert.ok(byPath.body.includes("November"));

    await assert.rejects(() => readVaultNote(dir, "../outside"), /escapes/);
    await assert.rejects(() => readVaultNote(dir, "nope"), /not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
