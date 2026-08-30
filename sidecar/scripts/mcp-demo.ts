// Proof script for the stash MCP server (T13).
//
// Creates a temp vault with a few notes, spawns src/mcp.ts as a stdio MCP
// server (STASH_VAULT_DIR pointing at the temp vault), performs the MCP
// handshake via the SDK client, calls search_notes / read_note / list_tasks /
// list_recent, and asserts that matching note content comes back. Exits 0 on
// success, 1 on any failed assertion.
//
// Run: npm --prefix sidecar run mcp:demo   (or: cd sidecar && npx tsx scripts/mcp-demo.ts)
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sidecarDir = fileURLToPath(new URL("..", import.meta.url));

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

function firstText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((c) => c.type === "text")?.text;
  if (typeof text !== "string") throw new Error("no text content in tool result");
  return text;
}

const vaultDir = await mkdtemp(join(tmpdir(), "stash-mcp-demo-"));

await writeFile(
  join(vaultDir, "20260801-101500-groceries.md"),
  `---
id: 20260801-101500-groceries
created: 2026-08-01T10:15:00.000Z
kind: note
tags: [shopping]
---
Groceries list

Buy oat milk and rye bread.
`,
);
await writeFile(
  join(vaultDir, "20260810-090000-file-taxes.md"),
  `---
id: 20260810-090000-file-taxes
created: 2026-08-10T09:00:00.000Z
kind: task
tags: [admin]
deadline: 2026-09-15
done: false
---
File taxes

Gather receipts first.
`,
);
await writeFile(
  join(vaultDir, "20260820-180000-mcp-idea.md"),
  `---
id: 20260820-180000-mcp-idea
created: 2026-08-20T18:00:00.000Z
kind: knowledge
tags: [dev, mcp]
---
MCP idea

Expose the vault over an MCP server so Claude Code can search notes.
`,
);

const transport = new StdioClientTransport({
  command: process.execPath, // node
  args: ["--import", "tsx", "src/mcp.ts"],
  cwd: sidecarDir,
  env: { ...process.env, STASH_VAULT_DIR: vaultDir } as Record<string, string>,
  stderr: "inherit",
});
const client = new Client({ name: "mcp-demo", version: "0.1.0" });

try {
  await client.connect(transport); // spawns the server and runs initialize

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  console.log("tools:", names.join(", "));
  assert(
    ["list_recent", "list_tasks", "read_note", "search_notes"].every((n) => names.includes(n)),
    "all four tools are registered",
  );

  // search_notes: must return matching note content
  const search = await client.callTool({ name: "search_notes", arguments: { query: "oat milk" } });
  const searchText = firstText(search);
  console.log("search_notes('oat milk') ->", searchText);
  assert(searchText.includes("20260801-101500-groceries"), "search result contains matching note id");
  assert(searchText.includes("Buy oat milk and rye bread."), "search snippet contains matching note content");

  // read_note by id
  const read = await client.callTool({
    name: "read_note",
    arguments: { id_or_path: "20260801-101500-groceries" },
  });
  const readText = firstText(read);
  assert(readText.includes("Buy oat milk and rye bread."), "read_note returns full body");
  assert(readText.includes('"kind": "note"'), "read_note returns frontmatter");

  // read_note must reject vault escapes
  const escape = await client.callTool({
    name: "read_note",
    arguments: { id_or_path: "../../etc/hosts" },
  });
  assert(escape.isError === true, "read_note rejects path escaping the vault");

  // list_tasks: open task with deadline
  const tasks = await client.callTool({ name: "list_tasks", arguments: {} });
  const tasksText = firstText(tasks);
  assert(tasksText.includes("20260810-090000-file-taxes"), "list_tasks includes the open task");
  assert(!tasksText.includes("groceries"), "list_tasks excludes non-task notes");

  // list_recent: newest first
  const recent = await client.callTool({ name: "list_recent", arguments: { n: 2 } });
  const recentText = firstText(recent);
  const parsed = JSON.parse(recentText) as { notes: Array<{ id: string }> };
  assert(parsed.notes.length === 2, "list_recent returns n notes");
  assert(parsed.notes[0].id === "20260820-180000-mcp-idea", "list_recent is newest-first");

  console.log("mcp-demo: all assertions passed");
} finally {
  await client.close();
  await rm(vaultDir, { recursive: true, force: true });
}
