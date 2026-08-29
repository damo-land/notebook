// Typed wrappers over the Rust-side SQLite index (src-tauri/src/index.rs).
// The vault is the source of truth; these query the derived index.

import { invoke } from "@tauri-apps/api/core";
import type { NoteKind } from "./vault";

/** A note row from the SQLite index (frontmatter + first-line title + tags). */
export interface IndexedNote {
  id: string;
  path: string;
  kind: NoteKind;
  created: string;
  /** First non-empty body line. */
  title: string;
  done: boolean | null;
  deadline: string | null;
  alert: string | null;
  tags: string[];
}

/** Full-text search over note bodies, plus title and tag substring match. */
export function searchNotes(text: string): Promise<IndexedNote[]> {
  return invoke("search_notes", { text });
}

/** Task notes; `category` filters to tasks tagged with it. */
export function listTasks(opts: { category?: string } = {}): Promise<IndexedNote[]> {
  return invoke("list_tasks", { category: opts.category ?? null });
}

/** Notes whose alert is due at `now` (ISO 8601) and not completed. */
export function dueAlerts(now: string): Promise<IndexedNote[]> {
  return invoke("due_alerts", { now });
}

/** Drops and rebuilds the index from the vault. Returns the note count. */
export function reindex(): Promise<number> {
  return invoke("reindex");
}
