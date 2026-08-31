// Suggested vault path for the setup view (T6, stash-installable-app).
//
// Stash notes are plain markdown, so the friendliest default is a `stash/`
// folder INSIDE the user's Obsidian vault — the notes then show up in
// Obsidian for free. Obsidian keeps its vault registry at
// `~/Library/Application Support/obsidian/obsidian.json`, shape
// `{"vaults": {"<id>": {"path": "/abs/path", "ts": ..., "open": true}}}`,
// where `open: true` marks the currently/last-open vault (the flag may be
// absent on every entry).
//
// Pure and DOM-free on purpose, like the other rules in src/lib/ (see
// view-restore.ts): the caller reads and JSON-parses the registry file (or
// passes null when there is none) and this decides the suggestion.
// scripts/obsidian-vaults-demo.ts proves it without a DOM or a real file.

/**
 * The vault path pre-filled into the setup view's input: `<vault>/stash/`
 * for the preferred Obsidian vault, else `<home>/Stash`.
 *
 * `obsidianJson` is the parsed content of obsidian.json, or null when the
 * file is missing/unreadable. Any malformed shape falls back rather than
 * throwing — this runs on first launch, before the user can do anything.
 *
 * Preference among vaults: the one marked `open: true`, else the first entry
 * carrying a usable string path.
 */
export function suggestVaultPath(obsidianJson: unknown, home: string): string {
  const vault = pickVault(obsidianJson);
  return vault ? `${vault}/stash/` : `${home}/Stash`;
}

/** The preferred Obsidian vault's path, or null when there is none. */
function pickVault(obsidianJson: unknown): string | null {
  if (typeof obsidianJson !== "object" || obsidianJson === null) return null;
  const vaults = (obsidianJson as { vaults?: unknown }).vaults;
  if (typeof vaults !== "object" || vaults === null) return null;

  let first: string | null = null;
  for (const entry of Object.values(vaults)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { path, open } = entry as { path?: unknown; open?: unknown };
    if (typeof path !== "string" || path === "") continue;
    if (open === true) return path; // the open vault always wins
    first ??= path;
  }
  return first;
}
