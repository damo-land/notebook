import { dismissOverlay } from "./overlay";

/**
 * Overlay keymap: Esc and Ctrl+W dismiss the overlay window.
 * Bound once at the app root (src/main.tsx). Returns an unbind function.
 *
 * Mode-aware, and this is what makes Esc layered: a key the active view
 * already consumed never reaches here (or arrives defaultPrevented), so it
 * backs out of that view's inner state instead of dismissing. Each layer
 * calls preventDefault + stopPropagation for Esc — an open command palette,
 * an open field menu, an open field editor, a note open in the editor, and
 * the tasks/search/chat views — so Esc only reaches this listener from a
 * view's top level, and only then does the overlay go away.
 *
 * Reaching this listener at all depends on something in the page holding
 * focus: a keydown is delivered to the focused element and bubbles from
 * there, so with nothing focused no Esc arrives here. That is why focus and
 * Esc were broken together before the overlay-shown wiring in ./overlay.
 */
export function bindOverlayKeys(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (
      event.key === "Escape" ||
      (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "w")
    ) {
      event.preventDefault();
      dismissOverlay();
    }
  };
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
