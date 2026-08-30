// Search view (T10): `/search` in the capture palette morphs the input into a
// vault search box. Every keystroke queries the SQLite index (searchNotes:
// FTS5 over bodies + LIKE over titles and tags); hits render underneath.
//
// Keys: Up/Down move selection; Enter opens the selected note in the T7
// editor (which renders above this view — Esc there drops back here); ⌘⌫
// deletes the selected note (to the macOS Trash — bare Backspace still edits
// the query); Esc goes back to the capture view (overlay stays up); Ctrl+W
// hides the overlay.
//
// Fetch model: one query per keystroke, no cache — the vault is
// personal-scale. Out-of-order responses are dropped via the effect's
// `cancelled` flag, so the list always reflects the latest query.
//
// Like the tasks view, this component remounts whenever the view is entered
// or the editor closes over it, so opening a hit and Esc-ing back lands on an
// empty search box. Accepted for consistency with T8's model; holding the
// query would mean lifting state into App.

import { useEffect, useRef, useState } from "react";
import { deleteNote, isDeleteChord, searchNotes, type IndexedNote } from "../lib/index-api";
import { openNote } from "../lib/note-editor-bus";
import { dismissOverlay, useFocusOnOverlayShown } from "../lib/overlay";

/** Result cap. The index is unbounded; the overlay shows a screenful. */
const MAX_RESULTS = 20;

interface SearchViewProps {
  /** Back to the capture view (Esc; also after Ctrl+W hides the overlay). */
  onClose: () => void;
}

export function SearchView({ onClose }: SearchViewProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IndexedNote[]>([]);
  // True once a non-empty query has resolved: separates "no matches" from
  // "nothing typed yet".
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // Per-keystroke query. An empty query fires nothing (no wildcard) and
  // clears the list.
  useEffect(() => {
    if (query.trim() === "") {
      setResults([]);
      setSearched(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const hits = await searchNotes(query);
        if (!cancelled) setResults(hits.slice(0, MAX_RESULTS));
      } catch (err) {
        console.error("search failed:", err);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearched(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  // This view's primary input: focused on mount and on every reopen.
  useFocusOnOverlayShown(inputRef);

  const selectedNote = results[Math.min(selected, Math.max(results.length - 1, 0))] ?? null;

  // The result list is height-capped and scrolls internally (T4), so
  // arrow-key selection has to drag its row into view — presentational only.
  const selectedRowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedNote?.id]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); // don't let the caret jump in the input
      const n = results.length;
      if (n > 0) {
        setSelected((i) => {
          const cur = Math.min(i, n - 1);
          return event.key === "ArrowDown" ? (cur + 1) % n : (cur - 1 + n) % n;
        });
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (selectedNote) openNote(selectedNote.id); // T7 editor overlays; Esc returns here
      return;
    }
    // ⌘⌫ deletes the selected hit — file to the macOS Trash, row out of the
    // index (T4). metaKey-guarded, so bare Backspace still edits the query.
    // Optimistic removal, like the tasks view's markDone: the command already
    // dropped the index row, so the list and the index agree.
    if (isDeleteChord(event)) {
      event.preventDefault();
      if (selectedNote) {
        void deleteNote(selectedNote.id)
          .then(() => setResults((prev) => prev.filter((n) => n.id !== selectedNote.id)))
          .catch((err) => console.error("delete note failed:", err));
      }
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
      // Hide the overlay AND leave search, so the next plain toggle
      // (alt+space) reopens in capture, not a stale search.
      event.preventDefault();
      dismissOverlay();
      onClose();
    }
  };

  return (
    <div className="search-view">
      <input
        ref={inputRef}
        className="overlay-input"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0); // new results: selection back to the top
        }}
        onKeyDown={onKeyDown}
        placeholder="Search…"
        autoFocus
        spellCheck={false}
        aria-label="search notes"
      />
      {results.length === 0 ? (
        <div className="tasks-empty under-input">
          {searched ? "no matches" : "type to search"}
        </div>
      ) : (
        <ul className="tasks-list under-input" role="listbox" aria-label="search results">
          {results.map((note) => (
            <li
              key={note.id}
              ref={note.id === selectedNote?.id ? selectedRowRef : undefined}
              role="option"
              aria-selected={note.id === selectedNote?.id}
              className={"task-row" + (note.id === selectedNote?.id ? " task-row-selected" : "")}
            >
              <span className="task-title">{note.title || note.id}</span>
              <span className={`chip chip-kind chip-${note.kind}`}>{note.kind}</span>
              <span className="task-deadline">{note.created.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
