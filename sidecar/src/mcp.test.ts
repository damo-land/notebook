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
