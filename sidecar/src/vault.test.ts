// Vault helpers for the ollama chat tools (T3): keyword search + single-note
// read over a real (temp) directory of markdown notes.
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

test("searchVault: symlinked notes are skipped during enumeration", async (t) => {
  const dir = await makeVault();
  const outside = await mkdtemp(join(tmpdir(), "stash-vault-outside-"));
  try {
    await writeFile(join(outside, "secret.md"), "Zanzibar contraband ledger\n\noutside the vault\n");
    try {
      await symlink(join(outside, "secret.md"), join(dir, "sneaky.md"));
    } catch (err) {
      t.skip(`filesystem does not support symlinks: ${(err as Error).message}`);
      return;
    }
    // The outside file's content must appear in NO hit — id, title or snippet.
    const hits = await searchVault(dir, "zanzibar contraband ledger vault");
    assert.ok(!JSON.stringify(hits).toLowerCase().includes("zanzibar"));
    assert.ok(!JSON.stringify(hits).includes("outside the vault"));
    // Honest notes still search exactly as before alongside the hostile link.
    const honest = await searchVault(dir, "sourdough starter");
    assert.equal(honest.length, 1);
    assert.equal(honest[0]!.id, "20260101-000000-sourdough");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("readVaultNote: symlinks escaping the vault are rejected", async (t) => {
  const dir = await makeVault();
  const outside = await mkdtemp(join(tmpdir(), "stash-vault-outside-"));
  try {
    await writeFile(join(outside, "secret.md"), "outside the vault\n");
    try {
      await symlink(join(outside, "secret.md"), join(dir, "sneaky.md"));
      await symlink(outside, join(dir, "linkdir"));
    } catch (err) {
      t.skip(`filesystem does not support symlinks: ${(err as Error).message}`);
      return;
    }
    // A symlinked FILE pointing out of the vault…
    await assert.rejects(() => readVaultNote(dir, "sneaky"), /escapes/);
    // …and a traversal THROUGH a symlinked directory.
    await assert.rejects(() => readVaultNote(dir, "linkdir/secret.md"), /escapes/);
    // Honest reads keep working alongside the hostile links.
    const ok = await readVaultNote(dir, "20260102-000000-tires");
    assert.ok(ok.body.includes("Winter tires"));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
