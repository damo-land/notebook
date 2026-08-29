// Demo/verification for the T10 search fixture. Run: npx tsx scripts/search-demo.ts
//
// THE PROOF FOR "search covers body text and tags" IS THE RUST TEST:
//   cd src-tauri && cargo test --test search_notes -- --nocapture
// The index is SQLite/FTS5 inside the Tauri process, so only a Rust test can
// index notes and assert what comes back.
//
// This script covers the half that lives in TypeScript: it writes the same
// three known notes into a temp vault via the real createNote path and asserts
// the on-disk shape the Rust query depends on — note A carries the search term
// in its BODY, note B carries its term only in the frontmatter `tags:` list
// (never in body or title), note C carries neither. That mismatch is exactly
// why search_notes needed a tags clause: frontmatter is stripped before the
// FTS insert, so B was unreachable until the index change landed.

import * as nodeFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert";
import { createNote, type VaultFs } from "../src/lib/vault";

const fs: VaultFs = {
  readFile: (p) => nodeFs.readFile(p, "utf8"),
  writeFile: (p, data) => nodeFs.writeFile(p, data, "utf8"),
  readdir: (p) => nodeFs.readdir(p),
  mkdir: async (p) => {
    await nodeFs.mkdir(p, { recursive: true });
  },
};

/** Split a note file into its frontmatter block and its body. */
function split(raw: string): { frontmatter: string; body: string } {
  const rest = raw.slice("---\n".length);
  const end = rest.indexOf("\n---\n");
  assert.ok(end !== -1, "note has no frontmatter block");
  return { frontmatter: rest.slice(0, end), body: rest.slice(end + "\n---\n".length) };
}

async function main() {
  const vaultDir = await nodeFs.mkdtemp(path.join(os.tmpdir(), "notebook-search-"));
  console.log("vault dir:", vaultDir);

  // (A) matches "borrow" by body text.
  const byBody = await createNote(fs, vaultDir, {
    body: "Ownership notes\n\nthe borrow checker rejects aliasing mutation\n",
    kind: "knowledge",
    tags: ["rust"],
  });
  // (B) matches "gardening" by tag only.
  const byTag = await createNote(fs, vaultDir, {
    body: "Repot the tomatoes\n\nthey outgrew the small pots\n",
    kind: "note",
    tags: ["gardening", "home"],
  });
  // (C) matches neither.
  const byNeither = await createNote(fs, vaultDir, {
    body: "Standup reminder\n\nmention the release date\n",
    kind: "note",
  });

  const a = split(await nodeFs.readFile(byBody.path, "utf8"));
  const b = split(await nodeFs.readFile(byTag.path, "utf8"));
  const c = split(await nodeFs.readFile(byNeither.path, "utf8"));

  // A: the term is in the body, which is what goes into the FTS table.
  assert.ok(a.body.includes("borrow"), "A: body term missing");
  assert.ok(!a.frontmatter.includes("borrow"), "A: term should not be a tag");

  // B: the term is ONLY in the frontmatter tags — not in the body, and not in
  // the first body line (the indexed `title`). Body FTS + title LIKE cannot
  // reach it; the tags clause added to search_notes is what finds it.
  assert.ok(b.frontmatter.includes("tags: [gardening, home]"), "B: tag not written");
  assert.ok(!b.body.includes("gardening"), "B: tag term leaked into the body");
  assert.ok(!b.body.split("\n")[0].includes("gardening"), "B: tag term leaked into the title");

  // C: neither term anywhere.
  for (const term of ["borrow", "gardening"]) {
    assert.ok(!c.body.includes(term) && !c.frontmatter.includes(term), `C: matched ${term}`);
  }

  console.log("A:", path.basename(byBody.path), '-> "borrow" in body only');
  console.log("B:", path.basename(byTag.path), '-> "gardening" in tags only');
  console.log("C:", path.basename(byNeither.path), "-> neither term");
  console.log("fixture checks passed");
  console.log(
    "index-level proof: cd src-tauri && cargo test --test search_notes -- --nocapture"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
