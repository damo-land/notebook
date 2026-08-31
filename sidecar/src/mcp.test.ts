// Symlink confinement for the MCP server's read_note (T7 audit fix).
//
// mcp.ts is an entry point — it connects its stdio server at import time — so
// importing it here would start a server inside the test process. Like
// scripts/mcp-demo.ts, the test spawns it as a child process instead and
// drives read_note over MCP stdio.
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sidecarDir = fileURLToPath(new URL("..", import.meta.url));

test("mcp read_note: symlinks escaping the vault are rejected", async (t) => {
  const vaultDir = await mkdtemp(join(tmpdir(), "stash-mcp-vault-"));
  const outside = await mkdtemp(join(tmpdir(), "stash-mcp-outside-"));
  try {
    await writeFile(join(outside, "secret.md"), "outside the vault\n");
    await writeFile(join(vaultDir, "real.md"), "---\nid: real\n---\nReal note\n");
    try {
      await symlink(join(outside, "secret.md"), join(vaultDir, "sneaky.md"));
      await symlink(outside, join(vaultDir, "linkdir"));
    } catch (err) {
      t.skip(`filesystem does not support symlinks: ${(err as Error).message}`);
      return;
    }

    const transport = new StdioClientTransport({
      command: process.execPath, // node
      args: ["--import", "tsx", "src/mcp.ts"],
      cwd: sidecarDir,
      env: { ...process.env, STASH_VAULT_DIR: vaultDir } as Record<string, string>,
      stderr: "ignore",
    });
    const client = new Client({ name: "mcp-symlink-test", version: "0.1.0" });
    try {
      await client.connect(transport); // spawns the server and runs initialize

      // Sanity: an honest note still reads fine.
      const ok = await client.callTool({ name: "read_note", arguments: { id_or_path: "real" } });
      assert.notEqual(ok.isError, true);
      assert.ok(JSON.stringify(ok.content).includes("Real note"));

      // A symlinked FILE pointing out of the vault…
      const viaFile = await client.callTool({
        name: "read_note",
        arguments: { id_or_path: "sneaky" },
      });
      assert.equal(viaFile.isError, true);

      // …and a traversal THROUGH a symlinked directory.
      const viaDir = await client.callTool({
        name: "read_note",
        arguments: { id_or_path: "linkdir/secret.md" },
      });
      assert.equal(viaDir.isError, true);

      // Whatever the errors say, the outside file's content must not leak.
      for (const res of [viaFile, viaDir]) {
        assert.ok(!JSON.stringify(res.content).includes("outside the vault"));
      }
    } finally {
      await client.close();
    }
  } finally {
    await rm(vaultDir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("mcp listings: symlinked notes are skipped during enumeration", async (t) => {
  const vaultDir = await mkdtemp(join(tmpdir(), "stash-mcp-vault-"));
  const outside = await mkdtemp(join(tmpdir(), "stash-mcp-outside-"));
  try {
    await writeFile(
      join(outside, "secret.md"),
      "---\nid: zanzibar-secret\nkind: task\n---\nZanzibar contraband ledger\n\noutside the vault\n",
    );
    await writeFile(join(vaultDir, "real.md"), "---\nid: real\n---\nReal note\n");
    try {
      await symlink(join(outside, "secret.md"), join(vaultDir, "sneaky.md"));
    } catch (err) {
      t.skip(`filesystem does not support symlinks: ${(err as Error).message}`);
      return;
    }

    const transport = new StdioClientTransport({
      command: process.execPath, // node
      args: ["--import", "tsx", "src/mcp.ts"],
      cwd: sidecarDir,
      env: { ...process.env, STASH_VAULT_DIR: vaultDir } as Record<string, string>,
      stderr: "ignore",
    });
    const client = new Client({ name: "mcp-symlink-list-test", version: "0.1.0" });
    try {
      await client.connect(transport); // spawns the server and runs initialize

      // The outside file's content must appear in NO search result, snippet,
      // task or listing title — across every tool that enumerates the vault.
      const search = await client.callTool({
        name: "search_notes",
        arguments: { query: "zanzibar" },
      });
      const tasks = await client.callTool({ name: "list_tasks", arguments: {} });
      const recent = await client.callTool({ name: "list_recent", arguments: { n: 10 } });
      // search_notes echoes the query back, so check its MATCHES, not the echo.
      assert.ok(JSON.stringify(search.content).includes('\\"count\\": 0'));
      for (const res of [search, tasks, recent]) {
        const text = JSON.stringify(res.content);
        assert.ok(!text.includes("contraband"));
        assert.ok(!text.includes("zanzibar-secret"));
        assert.ok(!text.includes("outside the vault"));
      }

      // Honest notes still list and search exactly as before.
      const honest = await client.callTool({ name: "search_notes", arguments: { query: "real" } });
      assert.ok(JSON.stringify(honest.content).includes("Real note"));
      assert.ok(JSON.stringify(recent.content).includes("Real note"));
    } finally {
      await client.close();
    }
  } finally {
    await rm(vaultDir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
