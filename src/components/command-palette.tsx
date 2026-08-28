// Presentational command menu, rendered under the capture input. Used both
// for the `/` command palette and the in-mode `/` field selector. Keyboard
// handling stays in App (the textarea keeps focus); this only renders the
// items and the current selection.

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface CommandPaletteProps {
  items: CommandItem[];
  /** id of the selected item (disabled items are never selected). */
  selectedId: string | null;
}

export function CommandPalette({ items, selectedId }: CommandPaletteProps) {
  if (items.length === 0) {
    return <div className="palette palette-empty">no matching command</div>;
  }
  return (
    <ul className="palette" role="listbox">
      {items.map((item) => (
        <li
          key={item.id}
          role="option"
          aria-selected={item.id === selectedId}
          aria-disabled={item.disabled || undefined}
          className={
            "palette-item" +
            (item.id === selectedId ? " palette-item-selected" : "") +
            (item.disabled ? " palette-item-disabled" : "")
          }
        >
          <span className="palette-label">/{item.label}</span>
          {item.hint && <span className="palette-hint">{item.hint}</span>}
        </li>
      ))}
    </ul>
  );
}
