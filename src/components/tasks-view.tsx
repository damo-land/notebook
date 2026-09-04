// Tasks view (T8): keyboard-only list of open tasks from the SQLite index.
//
// Keys: Up/Down move selection; Space marks the selected task done (writes
// `done: true` to frontmatter via the vault lib — the row is removed
// optimistically, since the watcher reindexes within ~1s anyway); clicking
// the empty ring at a row's left does the same via the same code path (T2,
// Space kept but made discoverable); Enter opens
// the note in the T7 editor; ⌘⌫ deletes the selected note (to the macOS
// Trash); Tab / Shift+Tab cycle the category filter
// (tags present on open tasks + "all", persisted in localStorage); Esc goes
// back to the capture view (overlay stays up); Ctrl+W hides the overlay.
//
// Fetch model: one `listTasks()` per mount (the component remounts whenever
// the view is entered or the editor closes over it); done-filter, sorting and
// category filtering are client-side via src/lib/task-list.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { deleteNote, isDeleteChord, listTasks, type IndexedNote } from "../lib/index-api";
import { linkify } from "../lib/linkify";
import { getVaultDir, updateNote } from "../lib/vault";
import { homeDir, tauriVaultFs } from "../lib/vault-fs";
import { openNote } from "../lib/note-editor-bus";
import { dismissOverlay, useFocusOnOverlayShown } from "../lib/overlay";
import {
  ALL_CATEGORIES,
  categoriesOf,
  cycleCategory,
  filterByCategory,
  openTasks,
  sortByDeadline,
} from "../lib/task-list";

/** localStorage key for the persisted category filter (survives restarts). */
const CATEGORY_STORAGE_KEY = "stash.tasks-view.category";

/** Task title with http(s) URLs rendered as clickable links (T2 chat-polish).
 *  Mirrors the chat view's `a` override: preventDefault so the webview never
 *  navigates, hand the href to the Rust `open_external` command (which
 *  re-validates http/https before spawning `open`). On top of that, in this
 *  row context: mousedown preventDefault keeps focus on the list container
 *  (same trick as the done ring) so Space/arrows keep working, and click
 *  stopPropagation keeps the click from reaching any row/ancestor handlers —
 *  a link click must not toggle the checkbox or move selection. */
function TaskTitle({ title }: { title: string }) {
  return (
    <span className="task-title">
      {linkify(title).map((segment, i) =>
        segment.kind === "url" ? (
          <a
            key={i}
            href={segment.text}
            className="task-link"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void invoke("open_external", { url: segment.text }).catch((err) =>
                console.error("open_external failed:", err),
              );
            }}
          >
            {segment.text}
          </a>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

function loadStoredCategory(): string {
  try {
    return localStorage.getItem(CATEGORY_STORAGE_KEY) ?? ALL_CATEGORIES;
  } catch {
    return ALL_CATEGORIES;
  }
}

function storeCategory(category: string): void {
  try {
    localStorage.setItem(CATEGORY_STORAGE_KEY, category);
  } catch {
    // persistence is best-effort
  }
}

interface TasksViewProps {
  /** Back to the capture view (Esc; also after Ctrl+W hides the overlay). */
  onClose: () => void;
}

export function TasksView({ onClose }: TasksViewProps) {
  const [tasks, setTasks] = useState<IndexedNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState(0);
  const [category, setCategory] = useState<string>(loadStoredCategory);

  const containerRef = useRef<HTMLDivElement>(null);
  const vaultDirRef = useRef<string | null>(null);
  const togglingRef = useRef(false);

  // One fetch per mount; the index is the read model.
  useEffect(() => {
    void (async () => {
      try {
        setTasks(sortByDeadline(openTasks(await listTasks())));
      } catch (err) {
        console.error("list tasks failed:", err);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Keyboard-only view: this list IS the primary input, so the container takes
  // focus on mount and on every reopen.
  useFocusOnOverlayShown(containerRef);

  const categories = useMemo(() => categoriesOf(tasks), [tasks]);
  const visible = useMemo(() => filterByCategory(tasks, category), [tasks, category]);
  const selectedTask = visible[Math.min(selected, Math.max(visible.length - 1, 0))] ?? null;

  // The list is height-capped and scrolls internally (T4), so arrow-key
  // selection has to drag its row into view — presentational only, the
  // selection logic above is untouched.
  const selectedRowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedTask?.id]);

  const setAndStoreCategory = useCallback((next: string) => {
    setCategory(next);
    storeCategory(next);
    setSelected(0);
  }, []);

  /** Space, or a click on a row's ring: mark done on disk (vault lib), drop
   *  the row optimistically. */
  const markDone = useCallback(async (task: IndexedNote) => {
    if (togglingRef.current) return;
    togglingRef.current = true;
    try {
      const vaultDir =
        vaultDirRef.current ?? (await getVaultDir(tauriVaultFs, await homeDir()));
      vaultDirRef.current = vaultDir;
      await updateNote(tauriVaultFs, vaultDir, task.id, {
        setFrontmatter: { done: true },
      });
      // Optimistic removal: the vault write succeeded (source of truth); the
      // watcher updates the index row within ~1s, so no refetch is needed.
      // Selection self-clamps: `selectedTask` derives via Math.min above.
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (err) {
      console.error("mark done failed:", err);
    } finally {
      togglingRef.current = false;
    }
  }, []);

  /** ⌘⌫: delete the selected task's note — file to the macOS Trash, row out
   *  of the index (T4). Same optimistic-removal shape as markDone; shares its
   *  in-flight guard so delete and done can't race on one row. */
  const deleteSelected = useCallback(async (task: IndexedNote) => {
    if (togglingRef.current) return;
    togglingRef.current = true;
    try {
      await deleteNote(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (err) {
      console.error("delete note failed:", err);
    } finally {
      togglingRef.current = false;
    }
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const n = visible.length;
      if (n > 0) {
        setSelected((i) => {
          const cur = Math.min(i, n - 1);
          return event.key === "ArrowDown" ? (cur + 1) % n : (cur - 1 + n) % n;
        });
      }
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (selectedTask) void markDone(selectedTask);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (selectedTask) openNote(selectedTask.id); // T7 editor overlays; Esc returns here
      return;
    }
    if (isDeleteChord(event)) {
      event.preventDefault();
      if (selectedTask) void deleteSelected(selectedTask);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      setAndStoreCategory(cycleCategory(categories, category, event.shiftKey ? -1 : 1));
      return;
    }
    if (event.key === "Escape") {
      // Back to capture; the overlay stays up. preventDefault keeps the
      // global keymap (which hides the window) out of it.
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "w") {
      // Hide the overlay AND leave tasks view, so the next plain toggle
      // (alt+space) reopens in capture, not a stale tasks list.
      event.preventDefault();
      dismissOverlay();
      onClose();
    }
  };

  return (
    <div
      ref={containerRef}
      className="tasks-view"
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="listbox"
      aria-label="open tasks"
    >
      <div className="tasks-header">
        <span className="tasks-title">tasks</span>
        <span className="tasks-filter">#{category}</span>
      </div>
      {visible.length === 0 ? (
        <div className="tasks-empty under-input">
          {loaded ? "no open tasks" + (category !== ALL_CATEGORIES ? ` in #${category}` : "") : "loading…"}
        </div>
      ) : (
        <ul className="tasks-list under-input">
          {visible.map((task) => (
            <li
              key={task.id}
              ref={task.id === selectedTask?.id ? selectedRowRef : undefined}
              role="option"
              aria-selected={task.id === selectedTask?.id}
              className={
                "task-row" + (task.id === selectedTask?.id ? " task-row-selected" : "")
              }
            >
              <button
                type="button"
                className="task-done-ring"
                aria-label={`mark "${task.title || task.id}" done`}
                // mousedown default would move focus off the list and break
                // Space; click still fires. Same code path as Space.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void markDone(task)}
              />
              <TaskTitle title={task.title || task.id} />
              {task.tags.map((tag) => (
                <span key={tag} className="chip task-tag">#{tag}</span>
              ))}
              <span className={task.deadline ? "task-deadline" : "task-deadline task-deadline-none"}>
                {task.deadline ?? "no deadline"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
