// Vault: markdown notes on disk. Pure file layer — the caller supplies a
// VaultFs (node fs/promises in scripts; Tauri fs later) and the vault dir.

import {
  parseNoteFile,
  serializeNoteFile,
  type FrontmatterValue,
  type ParsedFrontmatter,
} from "./frontmatter";

export interface VaultFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  /** Must create parents (recursive) and not fail if the dir exists. */
  mkdir(path: string): Promise<void>;
}

export type NoteKind = "note" | "knowledge" | "task";

export interface NoteFrontmatter {
  id: string;
  created: string; // ISO 8601
  kind: NoteKind;
  tags: string[];
  deadline?: string; // ISO date (task notes)
  done?: boolean; // task notes
  alert?: string; // ISO datetime (any note)
  [key: string]: FrontmatterValue | undefined;
}

export interface Note {
  id: string;
  path: string;
  frontmatter: NoteFrontmatter;
  body: string;
}

export interface NoteListing {
  id: string;
  path: string;
  frontmatter: NoteFrontmatter;
  firstLine: string;
}

export interface CreateNoteInput {
  body: string;
  kind?: NoteKind;
  tags?: string[];
  deadline?: string;
  done?: boolean;
  alert?: string;
}

export interface UpdateNotePatch {
  setFrontmatter?: Partial<NoteFrontmatter>;
  appendBody?: string;
  replaceBody?: string;
}

function slugify(body: string): string {
  const firstLine = body.split("\n")[0] ?? "";
  const slug = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "note";
}

function timestampPrefix(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function notePath(vaultDir: string, idOrPath: string): string {
  if (idOrPath.endsWith(".md") || idOrPath.includes("/")) return idOrPath;
  return `${vaultDir}/${idOrPath}.md`;
}

function toFrontmatter(fm: ParsedFrontmatter): NoteFrontmatter {
  const d = fm.data;
  return {
    ...d,
    id: typeof d.id === "string" ? d.id : "",
    created: typeof d.created === "string" ? d.created : "",
    kind: d.kind === "knowledge" || d.kind === "task" ? d.kind : "note",
    tags: Array.isArray(d.tags) ? d.tags : [],
  };
}

export async function createNote(
  fs: VaultFs,
  vaultDir: string,
  input: CreateNoteInput
): Promise<Note> {
  await fs.mkdir(vaultDir);
  const now = new Date();
  const base = `${timestampPrefix(now)}-${slugify(input.body)}`;
  const existing = await fs.readdir(vaultDir);
  let id = base;
  for (let n = 2; existing.includes(`${id}.md`); n++) id = `${base}-${n}`;

  const frontmatter: NoteFrontmatter = {
    id,
    created: now.toISOString(),
    kind: input.kind ?? "note",
    tags: input.tags ?? [],
  };
  if (input.deadline !== undefined) frontmatter.deadline = input.deadline;
  if (input.done !== undefined) frontmatter.done = input.done;
  if (input.alert !== undefined) frontmatter.alert = input.alert;

  const path = `${vaultDir}/${id}.md`;
  const data: ParsedFrontmatter["data"] = {};
  for (const [k, v] of Object.entries(frontmatter)) if (v !== undefined) data[k] = v;
  await fs.writeFile(path, serializeNoteFile({ data, extraLines: [] }, input.body));
  return { id, path, frontmatter, body: input.body };
}

export async function readNote(
  fs: VaultFs,
  vaultDir: string,
  idOrPath: string
): Promise<Note> {
  const path = notePath(vaultDir, idOrPath);
  const { fm, body } = parseNoteFile(await fs.readFile(path));
  const frontmatter = toFrontmatter(fm);
  return { id: frontmatter.id, path, frontmatter, body };
}

/**
 * Applies a patch to a note. The existing body bytes are re-emitted verbatim:
 * `appendBody` only concatenates after them; only `replaceBody` rewrites them.
 */
export async function updateNote(
  fs: VaultFs,
  vaultDir: string,
  idOrPath: string,
  patch: UpdateNotePatch
): Promise<Note> {
  const path = notePath(vaultDir, idOrPath);
  const { fm, body } = parseNoteFile(await fs.readFile(path));
  if (patch.setFrontmatter) {
    for (const [k, v] of Object.entries(patch.setFrontmatter)) {
      if (v === undefined) delete fm.data[k];
      else fm.data[k] = v;
    }
  }
  let newBody = patch.replaceBody !== undefined ? patch.replaceBody : body;
  if (patch.appendBody !== undefined) newBody += patch.appendBody;
  await fs.writeFile(path, serializeNoteFile(fm, newBody));
  const frontmatter = toFrontmatter(fm);
  return { id: frontmatter.id, path, frontmatter, body: newBody };
}

export async function listNotes(fs: VaultFs, vaultDir: string): Promise<NoteListing[]> {
  let names: string[];
  try {
    names = await fs.readdir(vaultDir);
  } catch {
    return [];
  }
  const notes: NoteListing[] = [];
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const path = `${vaultDir}/${name}`;
    const { fm, body } = parseNoteFile(await fs.readFile(path));
    const frontmatter = toFrontmatter(fm);
    notes.push({
      id: frontmatter.id || name.slice(0, -3),
      path,
      frontmatter,
      firstLine: body.split("\n")[0] ?? "",
    });
  }
  return notes;
}

/**
 * Resolves the vault dir: `~/.config/notebook/config.json` `{ "vaultDir" }`
 * if present, else `<homeDir>/Notebook`. A leading `~` in the configured
 * value expands to homeDir.
 */
export async function getVaultDir(fs: VaultFs, homeDir: string): Promise<string> {
  try {
    const raw = await fs.readFile(`${homeDir}/.config/notebook/config.json`);
    const cfg = JSON.parse(raw);
    if (typeof cfg.vaultDir === "string" && cfg.vaultDir) {
      return cfg.vaultDir.startsWith("~")
        ? homeDir + cfg.vaultDir.slice(1)
        : cfg.vaultDir;
    }
  } catch {
    // missing or malformed config -> default
  }
  return `${homeDir}/Notebook`;
}
