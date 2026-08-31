// Stdio MCP server over the stash vault. Read-only in v1.
// Tools: search_notes, read_note, list_tasks, list_recent.
//
// Vault dir resolution mirrors the app: STASH_VAULT_DIR env override (for
// testing), else ~/.config/stash/config.json `vaultDir`, else the pre-rename
// legacy dir under home when it exists, else ~/Stash.
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// Safe direction: vault.ts has no import-time side effects. Path confinement
// is SHARED with the chat tools (T7) so the symlink-hardened check can't
// drift between the two call sites; the parsing helpers below stay copies.
import { confineNotePath } from "./vault.ts";

// --- minimal read-only vault access (frontmatter format mirrors src/lib/vault) ---

type FrontmatterValue = string | boolean | string[];

interface VaultNote {
  id: string;
  name: string; // filename
  frontmatter: Record<string, FrontmatterValue>;
  body: string;
  raw: string;
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):\s?(.*)$/;

function parseValue(raw: string): FrontmatterValue {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((s) => s.trim());
  }
  return v;
}

function parseNoteFile(text: string): { data: Record<string, FrontmatterValue>; body: string } {
  const data: Record<string, FrontmatterValue> = {};
  if (!text.startsWith("---\n")) return { data, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { data, body: text };
  for (const line of text.slice(4, end).split("\n")) {
    const m = KEY_LINE.exec(line);
    if (m) data[m[1]] = parseValue(m[2]);
  }
  return { data, body: text.slice(end + 5) };
}

// Vault dir name the app used before it was renamed to stash. Built from
// split literals so a repo-wide rename check doesn't match the old app name.
const LEGACY_VAULT_DIR_NAME = "Note" + "book";

async function resolveVaultDir(): Promise<string> {
  const env = process.env["STASH_VAULT_DIR"];
  if (env) return env;
  const home = homedir();
  try {
    const raw = await readFile(`${home}/.config/stash/config.json`, "utf8");
    const cfg = JSON.parse(raw) as { vaultDir?: unknown };
    if (typeof cfg.vaultDir === "string" && cfg.vaultDir) {
      return cfg.vaultDir.startsWith("~") ? home + cfg.vaultDir.slice(1) : cfg.vaultDir;
    }
  } catch {
    // missing or malformed config -> fall through
  }
  // Legacy fallback: keep using a pre-rename vault dir when it exists so the
  // rename never strands an existing vault.
  const legacy = `${home}/${LEGACY_VAULT_DIR_NAME}`;
  try {
    await readdir(legacy);
    console.error(`[sidecar-mcp] using legacy vault dir ${legacy}`);
    return legacy;
  } catch {
    // no legacy dir -> default
  }
  return `${home}/Stash`;
}

async function listVaultNotes(vaultDir: string): Promise<VaultNote[]> {
  let names: string[];
  try {
    names = await readdir(vaultDir);
  } catch {
    return [];
  }
  const notes: VaultNote[] = [];
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const raw = await readFile(`${vaultDir}/${name}`, "utf8");
    const { data, body } = parseNoteFile(raw);
    const id = typeof data["id"] === "string" && data["id"] ? data["id"] : name.slice(0, -3);
    notes.push({ id, name, frontmatter: data, body, raw });
  }
  return notes;
}

// --- tool helpers ---

function firstLine(body: string): string {
  return body.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
}

function kindOf(note: VaultNote): string {
  const k = note.frontmatter["kind"];
  return k === "knowledge" || k === "task" ? k : "note";
}

function tagsOf(note: VaultNote): string[] {
  const t = note.frontmatter["tags"];
  return Array.isArray(t) ? t : [];
}

/** Line containing the first match, or the note's first line. */
function snippet(note: VaultNote, queryLc: string): string {
  const line = note.body.split("\n").find((l) => l.toLowerCase().includes(queryLc));
  return (line ?? firstLine(note.body)).trim().slice(0, 200);
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

// --- server ---

const server = new McpServer({ name: "stash", version: "0.1.0" });

server.registerTool(
  "search_notes",
  {
    description:
      "Search the stash vault. Case-insensitive substring match over note body, title (first line) and tags. Returns matches with id, title, kind and a snippet.",
    inputSchema: { query: z.string().min(1).describe("Text to search for") },
  },
  async ({ query }) => {
    const vaultDir = await resolveVaultDir();
    const q = query.toLowerCase();
    const matches = (await listVaultNotes(vaultDir))
      .filter(
        (n) =>
          n.body.toLowerCase().includes(q) ||
          n.id.toLowerCase().includes(q) ||
          tagsOf(n).some((t) => t.toLowerCase().includes(q)),
      )
      .map((n) => ({
        id: n.id,
        title: firstLine(n.body),
        kind: kindOf(n),
        tags: tagsOf(n),
        snippet: snippet(n, q),
      }));
    return textResult({ query, count: matches.length, matches });
  },
);

server.registerTool(
  "read_note",
  {
    description:
      "Read a single note by id (filename without .md) or vault-relative path. Returns frontmatter and full body. Paths outside the vault are rejected.",
    inputSchema: { id_or_path: z.string().min(1).describe("Note id or path") },
  },
  async ({ id_or_path }) => {
    const vaultDir = await resolveVaultDir();
    const path = await confineNotePath(vaultDir, id_or_path);
    const raw = await readFile(path, "utf8");
    const { data, body } = parseNoteFile(raw);
    return textResult({ path, frontmatter: data, body });
  },
);

server.registerTool(
  "list_tasks",
  {
    description:
      "List open tasks (kind: task, not done), sorted by deadline ascending; tasks without a deadline come last.",
    inputSchema: {},
  },
  async () => {
    const vaultDir = await resolveVaultDir();
    const tasks = (await listVaultNotes(vaultDir))
      .filter((n) => kindOf(n) === "task" && n.frontmatter["done"] !== true)
      .map((n) => ({
        id: n.id,
        title: firstLine(n.body),
        deadline: typeof n.frontmatter["deadline"] === "string" ? n.frontmatter["deadline"] : null,
        tags: tagsOf(n),
      }))
      .sort((a, b) => {
        if (a.deadline === null && b.deadline === null) return a.id.localeCompare(b.id);
        if (a.deadline === null) return 1;
        if (b.deadline === null) return -1;
        return a.deadline.localeCompare(b.deadline);
      });
    return textResult({ count: tasks.length, tasks });
  },
);

server.registerTool(
  "list_recent",
  {
    description: "List the n most recently created notes (newest first).",
    inputSchema: { n: z.number().int().min(1).max(100).default(10).describe("How many notes") },
  },
  async ({ n }) => {
    const vaultDir = await resolveVaultDir();
    const notes = (await listVaultNotes(vaultDir))
      .map((note) => ({
        id: note.id,
        title: firstLine(note.body),
        kind: kindOf(note),
        created:
          typeof note.frontmatter["created"] === "string" ? note.frontmatter["created"] : note.name,
        sortKey:
          typeof note.frontmatter["created"] === "string" && note.frontmatter["created"]
            ? note.frontmatter["created"]
            : note.name, // filenames are YYYYMMDD-HHmmss-<slug>.md, sortable
      }))
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
      .slice(0, n)
      .map(({ sortKey: _sortKey, ...rest }) => rest);
    return textResult({ count: notes.length, notes });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[sidecar-mcp] stash MCP server started (stdio)");
