// Pure helpers for the tasks view (src/components/tasks-view.tsx): which
// indexed rows count as open tasks, their display order, and the category
// filter cycle. Kept out of the component so scripts can exercise them.

import type { IndexedNote } from "./index-api";

/** Filter value meaning "no category filter". */
export const ALL_CATEGORIES = "all";

/**
 * Open tasks: `done` is absent (null) or false. Quick capture never writes
 * `done`, so a freshly captured task has `done: null` in the index — it must
 * still show. Only `done: true` hides a task.
 */
export function openTasks(tasks: IndexedNote[]): IndexedNote[] {
  return tasks.filter((t) => t.done !== true);
}

/**
 * Deadline ascending (ISO strings compare lexicographically); tasks without
 * a deadline sort last, ordered by creation time among themselves.
 */
export function sortByDeadline(tasks: IndexedNote[]): IndexedNote[] {
  return [...tasks].sort((a, b) => {
    if (a.deadline !== null && b.deadline !== null) {
      if (a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
    } else if (a.deadline !== null) {
      return -1;
    } else if (b.deadline !== null) {
      return 1;
    }
    return a.created < b.created ? -1 : a.created > b.created ? 1 : 0;
  });
}

/** `"all"` plus every tag present on the given tasks, sorted, deduped. */
export function categoriesOf(tasks: IndexedNote[]): string[] {
  const tags = new Set<string>();
  for (const t of tasks) for (const tag of t.tags) tags.add(tag);
  return [ALL_CATEGORIES, ...[...tags].sort()];
}

/**
 * Next filter value after `current` (wrapping). A `current` not in
 * `categories` (e.g. a persisted tag whose tasks are gone) cycles to "all".
 */
export function cycleCategory(
  categories: string[],
  current: string,
  direction: 1 | -1 = 1
): string {
  const n = categories.length;
  if (n === 0) return ALL_CATEGORIES;
  const idx = categories.indexOf(current);
  if (idx === -1) return categories[0];
  return categories[(idx + direction + n) % n];
}

/** Tasks visible under a category filter. */
export function filterByCategory(tasks: IndexedNote[], category: string): IndexedNote[] {
  if (category === ALL_CATEGORIES) return tasks;
  return tasks.filter((t) => t.tags.includes(category));
}
