// Minimal hand-rolled YAML-ish frontmatter: flat `key: value` pairs between
// `---` delimiter lines. Lists are inline `[a, b]`. Booleans are true/false.
// Unknown keys and non-matching lines pass through round-trip untouched.

export type FrontmatterValue = string | boolean | string[];

export interface ParsedFrontmatter {
  data: Record<string, FrontmatterValue>;
  /** Lines inside the frontmatter block that are not `key: value` pairs. */
  extraLines: string[];
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):\s?(.*)$/;

/** Canonical key order for serialization; other keys follow in parse order. */
const KEY_ORDER = ["id", "created", "kind", "tags", "deadline", "done", "alert"];

function parseValue(raw: string): FrontmatterValue {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((s) => s.trim());
  }
  return v;
}

function serializeValue(value: FrontmatterValue): string {
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

/**
 * Splits a note file into frontmatter and body. The body is returned exactly
 * as it appears in the file (bytes verbatim after the closing `---` line).
 */
export function parseNoteFile(text: string): { fm: ParsedFrontmatter; body: string } {
  const fm: ParsedFrontmatter = { data: {}, extraLines: [] };
  if (!text.startsWith("---\n")) return { fm, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { fm, body: text };
  const block = text.slice(4, end);
  const body = text.slice(end + 5);
  for (const line of block.split("\n")) {
    const m = KEY_LINE.exec(line);
    if (m) fm.data[m[1]] = parseValue(m[2]);
    else fm.extraLines.push(line);
  }
  return { fm, body };
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
