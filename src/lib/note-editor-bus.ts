// Open-a-note-by-id bus. T8/T10 (and any other code) call `openNote(id)`;
// App subscribes once via `onOpenNote` and shows the editor. A plain
// window CustomEvent keeps it dependency-free and decoupled from React.

const EVENT = "notebook:open-note";

/** Ask the overlay to open the note with this id (or vault-relative path). */
export function openNote(id: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: id }));
}

/** Subscribe to open-note requests. Returns an unsubscribe function. */
export function onOpenNote(handler: (id: string) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<string>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
