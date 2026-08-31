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

/** Every note in the index, most recently modified (file mtime) first. */
export function listNotes(): Promise<IndexedNote[]> {
  return invoke("list_notes");
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

/** Moves the note's `.md` file to the macOS Trash (recoverable in Finder)
 *  and drops it from the index, so lists refresh immediately (T4). */
export function deleteNote(id: string): Promise<void> {
  return invoke("delete_note", { id });
}

/** ⌘⌫ — the delete-note chord (T4). metaKey only: bare Backspace (and
 *  Ctrl/Alt variants) keep their normal text-editing behaviour everywhere. */
export function isDeleteChord(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  return event.key === "Backspace" && event.metaKey && !event.ctrlKey && !event.altKey;
}
