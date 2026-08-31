// Knowledge-note enrichment (T12).
//
// APPEND-ONLY CONTRACT. The note's existing body is read once and re-emitted
// byte-for-byte. Enrichment may only:
//   (a) add the frontmatter fields `tags`, `source` and `enriched`,
//   (b) append one `## Context` section after the existing body,
//   (c) put `[[wiki-links]]` to existing notes inside that appended section.
// Nothing here rewrites, reorders or reflows user text, and existing tags are
// merged rather than replaced. Every failure path throws *before* the write,
// so a note whose enrichment fails is left exactly as the user saved it — and
// with no `enriched` marker, which is what makes the app's next start retry it.
//
// The write itself is a compare-and-swap onto a temp file in the note's own
// directory, renamed over the target. The model call can run for minutes, so
// the in-memory copy read at job start goes stale: the alerts scheduler (which
// polls every 30s) or the user's own editor can land a write inside that
// window. A plain writeFile of the stale content would silently erase it —
// including an `alerted: true` marker, which would re-fire the notification.
//
// Standalone by design, like src/mcp.ts: its own copy of the frontmatter
// helpers rather than an import across into the root package's src/. The
// format is the one in src/lib/vault/frontmatter.ts and src-tauri/src/index.rs.
import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

// --- frontmatter (mirrors src/lib/vault/frontmatter.ts) ----------------------

export type FrontmatterValue = string | boolean | string[];

export interface ParsedFrontmatter {
  data: Record<string, FrontmatterValue>;
  /** Lines inside the block that are not `key: value` pairs; preserved as-is. */
  extraLines: string[];
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):\s?(.*)$/;
const KEY_ORDER = ["id", "created", "kind", "tags", "deadline", "done", "alert"];

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

function serializeValue(value: FrontmatterValue): string {
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

/** Splits a note into frontmatter and body; the body is the bytes verbatim. */
export function parseNoteFile(text: string): { fm: ParsedFrontmatter; body: string } {
  const fm: ParsedFrontmatter = { data: {}, extraLines: [] };
  if (!text.startsWith("---\n")) return { fm, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { fm, body: text };
  for (const line of text.slice(4, end).split("\n")) {
    const m = KEY_LINE.exec(line);
    if (m) fm.data[m[1]] = parseValue(m[2]);
    else fm.extraLines.push(line);
  }
  return { fm, body: text.slice(end + 5) };
}

export function serializeNoteFile(fm: ParsedFrontmatter, body: string): string {
  const keys = [
    ...KEY_ORDER.filter((k) => k in fm.data),
    ...Object.keys(fm.data).filter((k) => !KEY_ORDER.includes(k)),
  ];
  const lines = keys.map((k) => `${k}: ${serializeValue(fm.data[k])}`);
  lines.push(...fm.extraLines);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

// --- path clamp (mirrors notePath in src/lib/vault/index.ts) -----------------

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

function clampToVault(vaultDir: string, path: string): string {
  const root = normalizeSegments(vaultDir);
  const resolved = normalizeSegments(path.startsWith("/") ? path : `${root}/${path}`);
  if (!resolved.startsWith(`${root}/`) || !resolved.endsWith(".md")) {
    throw new Error(`enrich target is not a note inside the vault: ${path}`);
  }
  return resolved;
}

// --- enrichment --------------------------------------------------------------

/** Hard cap on links added to the appended section (acceptance criterion). */
export const MAX_LINKS = 3;

/** URLs are fetched at most this many per note. */
const MAX_URLS = 3;

const CONTEXT_HEADING = "## Context";

export interface RelatedNote {
  id: string;
  title: string;
}

export interface EnrichParams {
  vaultDir: string;
  /** Absolute path to the note; must resolve inside `vaultDir`. */
  path: string;
  /** Candidate link targets, selected from the SQLite index by the Rust side. */
  related?: RelatedNote[];
}

export interface EnrichDeps {
  /**
   * Injected so the proof script can exercise the append-only, link-cap and
   * marker invariants with a stubbed response — no model call, no spend.
   */
  runPrompt(
    text: string,
    opts?: { tools?: string[]; allowedTools?: string[]; maxTurns?: number },
  ): Promise<string>;
  /**
   * Re-run the prompt once when the reply fails to parse, then give up as
   * usual (throw, note untouched, no marker). Set for the ollama provider
   * only — local models flub "reply with ONE JSON object" often enough that
   * one more attempt is worth a local call, whereas the claude path keeps its
   * original single-shot behaviour byte for byte. Default: off.
   */
  retryMalformedReplyOnce?: boolean;
  /** Injectable clock; only the `enriched` timestamp uses it. */
  now?(): Date;
}

export interface EnrichResult {
  path: string;
  status: "enriched" | "skipped";
  /** Why it was skipped (absent when enriched). */
  reason?: string;
  addedTags: string[];
  links: string[];
  source?: string;
  fetchedUrls: string[];
}

/** Bare http(s) URLs in the body, deduped, trailing punctuation trimmed. */
export function extractUrls(body: string): string[] {
  const found = body.match(/\bhttps?:\/\/[^\s<>()[\]"'`]+/g) ?? [];
  const out: string[] = [];
  for (const raw of found) {
    const url = raw.replace(/[.,;:!?]+$/, "");
    if (url.length > "https://".length && !out.includes(url)) out.push(url);
    if (out.length === MAX_URLS) break;
  }
  return out;
}

/**
 * Frontmatter is a flat one-line-per-key format: a tag containing a comma or a
 * bracket still *parses* but silently splits into two tags, so tags are
 * normalised to a single safe token each.
 */
function sanitizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .replace(/[,[\]]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

/** Existing tags keep their order; only genuinely new ones are appended. */
function mergeTags(existing: string[], proposed: string[]): { merged: string[]; added: string[] } {
  const merged = [...existing];
  const added: string[] = [];
  for (const raw of proposed) {
    const tag = sanitizeTag(raw);
    if (tag === "" || merged.includes(tag)) continue;
    merged.push(tag);
    added.push(tag);
  }
  return { merged, added };
}

const WIKI_LINK = /\[\[([^\]]+)\]\]/g;

/**
 * Keeps `[[links]]` only to notes that actually exist (the candidate ids we
 * handed the model) and only up to `MAX_LINKS` distinct targets. Anything else
 * is de-linked to plain text rather than left as a dangling link — a
 * hallucinated target must not survive the cap.
 */
export function clampLinks(
  context: string,
  candidateIds: Iterable<string>,
  max = MAX_LINKS,
): { text: string; links: string[] } {
  const allowed = new Set(candidateIds);
  const kept: string[] = [];
  const text = context.replace(WIKI_LINK, (_match, inner: string) => {
    const [rawTarget, rawDisplay] = inner.split("|");
    const target = rawTarget.trim();
    const display = (rawDisplay ?? rawTarget).trim();
    if (!allowed.has(target)) return display;
    if (kept.includes(target)) return `[[${target}]]`;
    if (kept.length >= max) return display;
    kept.push(target);
    return `[[${target}]]`;
  });
  return { text, links: kept };
}

function buildPrompt(body: string, urls: string[], related: RelatedNote[]): string {
  const parts = [
    "You are enriching one note in a personal markdown knowledge vault.",
    "",
    "NOTE BODY (verbatim — never repeat it back):",
    "<<<",
    body.trim(),
    ">>>",
  ];

  if (urls.length > 0) {
    parts.push(
      "",
      "This note references the URLs below. Use the WebFetch tool to read each one,",
      "then summarise what the page actually says — enough detail that the reader",
      "does not need to open the link again. This note is acting as a bookmark.",
      ...urls.map((u) => `- ${u}`),
    );
  }

  if (related.length > 0) {
    parts.push(
      "",
      "Existing notes in this vault. Reference one by writing [[<id>]] inline in your",
      `context text. Use ids from this list only, at most ${MAX_LINKS} of them, and only`,
      "where the connection is real — no link is far better than a forced one.",
      ...related.map((r) => `- ${r.id} — ${r.title}`),
    );
  }

  parts.push(
    "",
    "Reply with ONE JSON object and nothing else:",
    '{"tags": ["kebab-case-topic", ...], "context": "markdown paragraphs"}',
    "",
    '- "tags": 2 to 5 short lowercase kebab-case topic tags. No "#", no commas,',
    "  no brackets, no spaces inside a tag.",
    '- "context": markdown that will be APPENDED to the note under a',
    `  "${CONTEXT_HEADING}" heading. Do not write the heading yourself. Do not restate`,
    "  the note. Summarise any fetched pages, add background the note assumes,",
    "  and add [[wiki-links]] where genuinely relevant.",
  );

  return parts.join("\n");
}

interface Enrichment {
  tags: string[];
  context: string;
}

/** Pulls the JSON object out of the model's reply. Throws if there isn't one. */
export function parseEnrichment(reply: string): Enrichment {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error(`enrichment reply contained no JSON object: ${reply.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch (err) {
    throw new Error(`enrichment reply was not valid JSON: ${(err as Error).message}`);
  }
  const obj = parsed as { tags?: unknown; context?: unknown };
  const context = typeof obj.context === "string" ? obj.context.trim() : "";
  if (context === "") throw new Error("enrichment reply had an empty `context`");
  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((t): t is string => typeof t === "string")
    : [];
  return { tags, context };
}

/**
 * Thrown when the note changed on disk while the job was running, so the
 * enriched content built from the stale copy was NOT written.
 *
 * Deliberately the same shape as the model/parse failures — throws before any
 * write, note untouched, no `enriched` marker, so the next app start retries it
 * — but distinguishable: an in-process caller checks `instanceof` or `.code`,
 * and over the stdio protocol (where main.ts flattens errors to `err.message`)
 * the stable `enrich conflict:` message prefix is the discriminator.
 */
export class EnrichConflictError extends Error {
  readonly code = "enrich_conflict";
  constructor(message: string) {
    super(`enrich conflict: ${message}`);
    this.name = "EnrichConflictError";
  }
}

/**
 * Compare-and-swap write: replaces `path` with `next` only if the file still
 * holds exactly `expected`.
 *
 * The temp file lives in the note's OWN directory, because rename(2) is only
 * atomic within a single filesystem — a temp in /tmp would be a cross-device
 * rename, which either fails or degrades to a copy. Its name cannot collide
 * between concurrent writers and deliberately does not end in `.md`: the Rust
 * indexer scans for that extension (src-tauri/src/index.rs) and a stray match
 * would trigger a spurious reindex. It is removed on the failure path too.
 */
async function casWrite(path: string, expected: Buffer, next: string): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.enrich-${process.pid}-${randomUUID()}.tmp`);
  await writeFile(tmp, next, "utf8");
  try {
    // The check sits here, after the temp file exists, so that nothing but the
    // rename itself follows it — the smallest window we can leave.
    let current: Buffer;
    try {
      current = await readFile(path);
    } catch (err) {
      throw new EnrichConflictError(`note is no longer readable: ${(err as Error).message}`);
    }
    if (!current.equals(expected)) {
      throw new EnrichConflictError(
        `the note changed on disk during enrichment (${expected.length} bytes at job start, ` +
          `${current.length} now); not writing, so the next start retries it`,
      );
    }
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** The appended block, kept clearly separated from the body it follows. */
function contextSection(body: string, context: string): string {
  const lead = body === "" || body.endsWith("\n") ? "\n" : "\n\n";
  return `${lead}${CONTEXT_HEADING}\n\n${context.trim()}\n`;
}

/**
 * Enriches one knowledge note in place, append-only.
 *
 * Returns `skipped` (without touching the file) when the note is already
 * enriched or is not a knowledge note. Throws on any failure — the caller
 * reports it and the note stays untouched and unmarked, so the next app start
 * retries it. `EnrichConflictError` is that same shape for the one failure the
 * caller may want to tell apart: the note changed while the job was running.
 */
export async function enrichNote(
  params: EnrichParams,
  deps: EnrichDeps,
): Promise<EnrichResult> {
  const path = clampToVault(params.vaultDir, params.path);
  const related = params.related ?? [];

  // The exact bytes the enrichment is built from; the write below refuses to
  // land unless the file still holds them.
  const rawBytes = await readFile(path);
  const { fm, body } = parseNoteFile(rawBytes.toString("utf8"));

  if (fm.data["kind"] !== "knowledge") {
    return { path, status: "skipped", reason: "not a knowledge note", addedTags: [], links: [], fetchedUrls: [] };
  }
  // The marker is the whole idempotence story: enriched once, never again.
  const marker = fm.data["enriched"];
  if (typeof marker === "string" && marker !== "") {
    return { path, status: "skipped", reason: `already enriched at ${marker}`, addedTags: [], links: [], fetchedUrls: [] };
  }

  const urls = extractUrls(body);
  const prompt = buildPrompt(body, urls, related);
  const promptOpts =
    urls.length > 0
      ? // Bookmark behaviour: the model reads the referenced page itself.
        // `tools` makes WebFetch available; `allowedTools` is what stops it
        // asking for permission we cannot answer in a background process.
        { tools: ["WebFetch"], allowedTools: ["WebFetch"], maxTurns: 8 }
      : {};
  // The model call sits OUTSIDE the try: a call failure (unreachable daemon,
  // missing model, no auth) always throws after exactly one attempt. Only a
  // reply that came back but fails to parse is retried, and only when the
  // deps ask for it; the rethrow on the second failure is the same
  // marker-safe skip as today.
  const reply = await deps.runPrompt(prompt, promptOpts);
  let enrichment: Enrichment;
  try {
    enrichment = parseEnrichment(reply);
  } catch (err) {
    if (deps.retryMalformedReplyOnce !== true) throw err;
    enrichment = parseEnrichment(await deps.runPrompt(prompt, promptOpts));
  }
  const { tags: proposedTags, context } = enrichment;

  const { text, links } = clampLinks(
    context,
    related.map((r) => r.id),
  );
  const existingTags = Array.isArray(fm.data["tags"]) ? fm.data["tags"] : [];
  const { merged, added } = mergeTags(existingTags, proposedTags);

  const newBody = body + contextSection(body, text);
  // Belt and braces: the append-only contract, asserted rather than assumed.
  if (!newBody.startsWith(body)) {
    throw new Error("append-only invariant violated: original body bytes changed");
  }

  fm.data["tags"] = merged;
  // `source` is the note's own first URL, not something the model supplies —
  // a bookmark's source has to be verifiable, not generated.
  const source = urls[0];
  if (source !== undefined) fm.data["source"] = source;
  fm.data["enriched"] = (deps.now?.() ?? new Date()).toISOString();

  // Throws EnrichConflictError without writing anything if someone else
  // touched the note while the model was thinking.
  await casWrite(path, rawBytes, serializeNoteFile(fm, newBody));

  return {
    path,
    status: "enriched",
    addedTags: added,
    links,
    source,
    fetchedUrls: urls,
  };
}
