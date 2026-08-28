import { invoke } from "@tauri-apps/api/core";

function hideOverlay(): void {
  void invoke("hide_overlay");
}

/**
 * Overlay keymap: Esc and Ctrl+W hide the overlay window.
 * Bound once at the app root (src/main.tsx). Returns an unbind function.
 *
 * Mode-aware: a key the capture UI already consumed (capture-mode Esc, menu
 * navigation — App calls preventDefault + stopPropagation) never reaches
 * here or arrives defaultPrevented, so it does not hide the overlay. Plain
 * capture leaves Esc untouched and the overlay hides as before.
 */
export function bindOverlayKeys(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (
      event.key === "Escape" ||
      (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "w")
    ) {
      event.preventDefault();
      hideOverlay();
    }
  };
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
