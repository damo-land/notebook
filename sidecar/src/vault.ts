// Read-only vault access for the ollama chat tools (T3): keyword search over
// the note files plus a single-note read.
//
// Deliberately a flat-file scan, not the SQLite index: the index lives on the
// Rust side and the sidecar has no DB layer — at PoC vault sizes (hundreds of
// notes) reading every .md per search is fine, and it can never be stale.
//
// The parsing/normalizing helpers mirror mcp.ts, which keeps its own private
// copies: mcp.ts is an ENTRY POINT (it connects its stdio server at import
// time), so importing it from here would start an MCP server inside every
// chat process. Copying ~60 lines beats that; a shared module extraction is a
// refactor deliberately not done in this task.
import { readFile, readdir } from "node:fs/promises";

type FrontmatterValue = string | boolean | string[];

export interface VaultNote {
  id: string;
  name: string; // filename
  frontmatter: Record<string, FrontmatterValue>;
  body: string;
}

/** A search hit: what the search_notes tool (and RAG-lite) feed the model. */
export interface NoteHit {
  id: string;
  title: string;
  snippet: string;
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

export function parseNoteFile(text: string): {
  data: Record<string, FrontmatterValue>;
  body: string;
} {
  const data: Record<string, FrontmatterValue> = {};
  if (!text.startsWith("---\n")) return { data, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { data, body: text };
  for (const line of text.slice(4, end).split("\n")) {
    const m = KEY_LINE.exec(line);
    if (m) data[m[1]!] = parseValue(m[2]!);
  }
  return { data, body: text.slice(end + 5) };
}

/** Collapses `.`/`..`/empty segments; `..` at the root is preserved. */
function normalizeSegments(path: string): string {
  const segs: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && segs.length > 0 && segs[segs.length - 1] !== "..") {
      segs.pop();
      continue;
    }
    segs.push(seg);
  }
  return (path.startsWith("/") ? "/" : "") + segs.join("/");
}

/** Resolves a note id or path to a normalized path INSIDE vaultDir; throws on escape. */
export function notePath(vaultDir: string, idOrPath: string): string {
  const root = normalizeSegments(vaultDir);
  const raw = idOrPath.endsWith(".md") || idOrPath.includes("/") ? idOrPath : `${idOrPath}.md`;
  const resolved = normalizeSegments(raw.startsWith("/") ? raw : `${root}/${raw}`);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new Error(`note path escapes vault dir: ${idOrPath}`);
  }
  return resolved;
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
    let raw: string;
    try {
      raw = await readFile(`${vaultDir}/${name}`, "utf8");
    } catch {
      continue; // a note deleted mid-scan is not an error
    }
    const { data, body } = parseNoteFile(raw);
    const id = typeof data["id"] === "string" && data["id"] ? data["id"] : name.slice(0, -3);
    notes.push({ id, name, frontmatter: data, body });
  }
  return notes;
}

function firstLine(body: string): string {
  return body.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
}

function tagsOf(note: VaultNote): string[] {
  const t = note.frontmatter["tags"];
  return Array.isArray(t) ? t : [];
}

/**
 * The user's message reduced to search keywords: lowercased words of >= 3
 * characters, deduped. A query with no such words falls back to the whole
 * trimmed query as one term.
 */
function keywords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}:_-]+/u)
    .filter((w) => w.length >= 3);
  if (words.length === 0) {
    const whole = query.trim().toLowerCase();
    return whole === "" ? [] : [whole];
  }
  return [...new Set(words)];
}

/** Line containing the first keyword match, else the note's first line. */
function snippetFor(note: VaultNote, kws: string[]): string {
  const line = note.body
    .split("\n")
    .find((l) => kws.some((kw) => l.toLowerCase().includes(kw)));
  return (line ?? firstLine(note.body)).trim().slice(0, 200);
}

/**
 * Naive keyword search over every .md in the vault: a note scores 2 per
 * keyword in its title (first body line) and 1 per keyword anywhere in
 * id/tags/body; non-zero scores rank, top `limit` return.
 */
export async function searchVault(
  vaultDir: string,
  query: string,
  limit = 8,
): Promise<NoteHit[]> {
  const kws = keywords(query);
  if (kws.length === 0) return [];
  const scored: Array<{ note: VaultNote; score: number }> = [];
  for (const note of await listVaultNotes(vaultDir)) {
    const title = firstLine(note.body).toLowerCase();
    const rest = `${note.id}\n${tagsOf(note).join(" ")}\n${note.body}`.toLowerCase();
    let score = 0;
    for (const kw of kws) {
      if (title.includes(kw)) score += 2;
      if (rest.includes(kw)) score += 1;
    }
    if (score > 0) scored.push({ note, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.note.id.localeCompare(b.note.id))
    .slice(0, limit)
    .map(({ note }) => ({
      id: note.id,
      title: firstLine(note.body),
      snippet: snippetFor(note, kws),
    }));
}

/** One note by id (filename sans .md) or vault-relative path. */
export async function readVaultNote(
  vaultDir: string,
  idOrPath: string,
): Promise<{ path: string; frontmatter: Record<string, FrontmatterValue>; body: string }> {
  const path = notePath(vaultDir, idOrPath);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`note not found: ${idOrPath}`);
  }
  const { data, body } = parseNoteFile(raw);
  return { path, frontmatter: data, body };
}
