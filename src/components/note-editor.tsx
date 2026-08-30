import { useRef, useState } from "react";
import type { Note } from "../lib/vault";
import { useFocusOnOverlayShown } from "../lib/overlay";

interface NoteEditorProps {
  note: Note;
  /** Called with the edited body; the caller persists and closes. */
  onSave: (newBody: string) => void;
  /** Close without saving. */
  onClose: () => void;
}

/** ISO datetime -> short date for a chip ("2026-08-27"). */
function shortDate(iso: string): string {
  return iso.slice(0, 10) || iso;
}

/**
 * Editor view for an existing note: read-only frontmatter chips (kind,
 * created, deadline, tags, done) above the same markdown textarea as
 * capture. Enter or Cmd+S saves, Shift+Enter inserts a newline, Esc closes
 * without saving. All three keys are consumed here (preventDefault +
 * stopPropagation for Esc) so neither the capture handlers nor the global
 * keymap (which hides the overlay) ever see them while the editor is open.
 */
export function NoteEditor({ note, onSave, onClose }: NoteEditorProps) {
  const [draft, setDraft] = useState(note.body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fm = note.frontmatter;

  // This view's primary input: focused on mount and on every reopen.
  useFocusOnOverlayShown(textareaRef);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const cmdS = event.key.toLowerCase() === "s" && event.metaKey && !event.ctrlKey && !event.altKey;
    if (cmdS || (event.key === "Enter" && !event.shiftKey)) {
      event.preventDefault();
      onSave(draft);
    }
    // Shift+Enter falls through: newline, consistent with capture.
  };

  return (
    <div className="capture">
      <div className="chips">
        <span className={`chip chip-kind chip-${fm.kind}`}>{fm.kind}</span>
        {fm.created && <span className="chip">{shortDate(fm.created)}</span>}
        {fm.deadline && <span className="chip">deadline {fm.deadline}</span>}
        {fm.tags.map((tag) => (
          <span key={tag} className="chip">
            #{tag}
          </span>
        ))}
        {fm.kind === "task" && <span className="chip">{fm.done ? "done" : "open"}</span>}
      </div>
      <textarea
        ref={textareaRef}
        className="overlay-input editor-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        spellCheck={false}
        rows={8}
      />
    </div>
  );
}
