import { invoke } from "@tauri-apps/api/core";

function hideOverlay(): void {
  void invoke("hide_overlay");
}

/**
 * Overlay keymap: Esc and Ctrl+W hide the overlay window.
 * Bound once at the app root (src/main.tsx). Returns an unbind function.
 */
export function bindOverlayKeys(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
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
