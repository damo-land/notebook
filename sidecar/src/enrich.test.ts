// Graceful degradation (T9): an auth failure during enrichment must write
// NOTHING — no `enriched` marker, no body change — so a later configured run
// still enriches the note. Stubbed runPrompt, no model call.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichNote } from "./enrich.ts";
import { NotAuthenticatedError } from "./llm.ts";

const NOTE =
  "---\nid: k-test\ncreated: 2026-08-30T10:00:00Z\nkind: knowledge\n---\nA note body.\n";

test("auth failure leaves the note untouched and unmarked", async () => {
  const vaultDir = await mkdtemp(join(tmpdir(), "enrich-auth-"));
  const path = join(vaultDir, "k-test.md");
  await writeFile(path, NOTE, "utf8");

  await assert.rejects(
    enrichNote(
      { vaultDir, path },
      {
        runPrompt: () =>
          Promise.reject(
            new NotAuthenticatedError("Not logged in · Please run /login"),
          ),
      },
    ),
    NotAuthenticatedError,
  );

  // Byte-for-byte untouched: no `enriched` marker, so a later configured run
  // re-selects it. And no stray temp files left behind either.
  assert.equal(await readFile(path, "utf8"), NOTE);
  assert.deepEqual(await readdir(vaultDir), ["k-test.md"]);
});
