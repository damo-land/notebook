// Undo for task completion in the tasks view (src/components/tasks-view.tsx).
//
// Completion writes `done: true` to disk immediately (no deferred write that
// could die with an unmount); undo writes the task's ORIGINAL `done` back.
// Entries live in a module-level stack, not component state, because the
// tasks view remounts on every entry / editor close — leaving and coming back
// within the grace window still allows undo. Pure helpers are exported for
// scripts/tasks-view-demo.ts.

import type { IndexedNote } from "./index-api";
import type { NoteFrontmatter } from "./vault";

/** How long after a completion Ctrl+Z can still reverse it. */
export const UNDO_GRACE_MS = 10_000;

export interface UndoEntry {
  task: IndexedNote;
  at: number;
}

/** Drop entries older than the grace window. */
export function pruneUndo(stack: UndoEntry[], now: number): UndoEntry[] {
  return stack.filter((e) => now - e.at < UNDO_GRACE_MS);
}

export function pushUndo(stack: UndoEntry[], task: IndexedNote, now: number): UndoEntry[] {
  return [...pruneUndo(stack, now), { task, at: now }];
}

/** Newest entry still inside the grace window, and the stack without it. */
export function popUndo(
  stack: UndoEntry[],
  now: number
): { entry: UndoEntry | null; rest: UndoEntry[] } {
  const live = pruneUndo(stack, now);
  if (live.length === 0) return { entry: null, rest: [] };
  return { entry: live[live.length - 1], rest: live.slice(0, -1) };
}

/** Frontmatter patch restoring the pre-completion `done`: the index holds
 *  `null` for a task captured without a `done` field, and updateNote deletes
 *  a key set to undefined — so the file round-trips to its original shape. */
export function restoreDonePatch(task: IndexedNote): Partial<NoteFrontmatter> {
  return { done: task.done ?? undefined };
}

// --- module-level store (survives tasks-view remounts) ----------------------

let stack: UndoEntry[] = [];

export function recordDone(task: IndexedNote, now = Date.now()): void {
  stack = pushUndo(stack, task, now);
}

export function takeUndo(now = Date.now()): UndoEntry | null {
  const { entry, rest } = popUndo(stack, now);
  stack = rest;
  return entry;
}

/** Put an entry back (the reverse write failed). */
export function returnUndo(entry: UndoEntry): void {
  stack = [...stack, entry];
}

/** When the newest live entry expires, or null if nothing is undoable. */
export function undoExpiresAt(now = Date.now()): number | null {
  stack = pruneUndo(stack, now);
  const last = stack[stack.length - 1];
  return last ? last.at + UNDO_GRACE_MS : null;
}
