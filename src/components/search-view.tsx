// Search view (T10): `/search` in the capture palette morphs the input into a
// vault search box. Every keystroke queries the SQLite index (searchNotes:
// FTS5 over bodies + LIKE over titles and tags); hits render underneath.
//
// Keys: Up/Down move selection; Enter opens the selected note in the T7
// editor (which renders above this view — Esc there drops back here); Esc
// goes back to the capture view (overlay stays up); Ctrl+W hides the overlay.
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
import { invoke } from "@tauri-apps/api/core";
import { searchNotes, type IndexedNote } from "../lib/index-api";
import { openNote } from "../lib/note-editor-bus";

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

  // Keep the input focused, including when the overlay window is re-shown
  // while this view is up.
  useEffect(() => {
    inputRef.current?.focus();
    const focus = () => inputRef.current?.focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);

  const selectedNote = results[Math.min(selected, Math.max(results.length - 1, 0))] ?? null;

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
      void invoke("hide_overlay");
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
        placeholder="Search the vault… (body text and tags)"
        autoFocus
        spellCheck={false}
        aria-label="search notes"
      />
      {results.length === 0 ? (
        <div className="tasks-empty">
          {searched ? "no matches" : "type to search"}
        </div>
      ) : (
        <ul className="tasks-list" role="listbox" aria-label="search results">
          {results.map((note) => (
            <li
              key={note.id}
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
      <div className="tasks-hint tasks-footer">
        ↑↓ select · Enter open · Esc back · Ctrl+W hide
      </div>
    </div>
  );
}
