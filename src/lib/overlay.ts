// Overlay shell wiring shared by all five views: the events that announce the
// panel coming and going, where focus lands when it appears, how a dismissal is
// played out, and how the window height follows the content.
//
// All of it exists because the overlay window is driven from AppKit, not from
// the page: the webview stays mounted and running the whole time the panel is
// hidden, so nothing in the DOM changes when the panel appears or disappears.
// The page has to be told.

import { useEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Emitted by Rust (`show_overlay`) every time the panel is put on screen.
 *
 * This — not a DOM `focus` event — is how a view learns it just became
 * visible. `show_and_make_key()` makes the panel key from AppKit while the
 * webview is already mounted, and WKWebView does not reliably fire a window
 * `focus` event for it. The old `window.addEventListener("focus", …)` wiring
 * therefore never ran on a reopen; the first open only looked right because
 * `autoFocus` fires at mount. With nothing focused, no keydown reached the
 * page either, which is why Esc appeared to be broken as well.
 */
export const OVERLAY_SHOWN_EVENT = "overlay-shown";

/**
 * Emitted by Rust (`hide_overlay_panel`) every time the panel leaves the
 * screen — Esc, Ctrl+W, the alt+space toggle, and clicking outside all funnel
 * through that one function, so this fires for every dismissal.
 */
export const OVERLAY_HIDDEN_EVENT = "overlay-hidden";

/**
 * Duration of the CSS leave animation, in ms. Must stay in step with the
 * `.overlay-motion.overlay-leaving` rule in src/App.css.
 */
const LEAVE_MS = 120;

/** Root element of the overlay; the single `<main>` App renders. */
function overlayRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".overlay");
}

/**
 * Dismiss the overlay: play the leave animation, then ask Rust to hide.
 *
 * Every dismissal the page initiates (Esc and Ctrl+W in the global keymap and
 * in each view, plus a saved capture) goes through here, so they all animate
 * the same way. The two dismissals the page does NOT initiate — clicking
 * outside, and alt+space toggling the panel off — cannot animate: macOS takes
 * the window off screen before the webview hears about it.
 */
export function dismissOverlay(): void {
  overlayRoot()?.classList.add("overlay-leaving");
  window.setTimeout(() => void invoke("hide_overlay"), LEAVE_MS);
}

/**
 * Restart the appear animation. The overlay element survives a hide/show
 * cycle untouched, so the CSS `animation` would only ever run once without
 * being explicitly retriggered; clearing it and forcing a reflow does that.
 *
 * Inert — not broken — if the `.overlay-motion` rules are deleted.
 */
function playEnterAnimation(el: HTMLElement): void {
  el.classList.remove("overlay-leaving");
  el.style.animation = "none";
  void el.offsetHeight; // reflow: without it the restart is coalesced away
  el.style.animation = "";
}

/**
 * Replay the appear animation on every open, and undo the leave animation as
 * soon as the panel is off screen.
 *
 * The undo matters: the leave animation ends at `forwards`, so it holds the
 * overlay at zero opacity. Clearing it on the hidden event — while nothing is
 * on screen — means the next open paints correctly from its very first frame,
 * instead of showing a blank panel for however long the shown event takes to
 * reach the page.
 */
export function useOverlayMotion<T extends HTMLElement>(ref: RefObject<T | null>): void {
  useEffect(() => {
    const shown = listen(OVERLAY_SHOWN_EVENT, () => {
      const el = ref.current;
      if (el) playEnterAnimation(el);
    });
    const hidden = listen(OVERLAY_HIDDEN_EVENT, () => {
      ref.current?.classList.remove("overlay-leaving");
    });
    return () => {
      void shown.then((f) => f());
      void hidden.then((f) => f());
    };
  }, [ref]);
}

/**
 * Put keyboard focus in `ref` at mount and on every open after that.
 *
 * Each view calls this with its own primary input, so "the active view's
 * input is focused" holds however the panel was summoned — including
 * alt+shift+space, which shows the panel and then switches to the tasks view.
 */
export function useFocusOnOverlayShown<T extends HTMLElement>(ref: RefObject<T | null>): void {
  useEffect(() => {
    const focus = () => ref.current?.focus();
    focus(); // first open: the panel is already up when this view mounts
    const unlisten = listen(OVERLAY_SHOWN_EVENT, focus);
    return () => {
      void unlisten.then((f) => f());
    };
  }, [ref]);
}

/**
 * Keep the native window's height equal to the rendered content's height.
 *
 * `resize_overlay` clamps in Rust (min one input row, max ~60% of the active
 * screen), so an overlong measurement here cannot stretch the panel past the
 * screen — past the clamp the window simply stops growing and the content
 * scrolls.
 */
export function useOverlayAutoHeight<T extends HTMLElement>(ref: RefObject<T | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Last height asked for, to swallow the no-op resizes ResizeObserver
    // reports after our own resize settles.
    let requested = 0;
    const apply = () => {
      // The content root's own box, deliberately NOT
      // `documentElement.scrollHeight`: that never reports less than the
      // viewport, so once the window had grown the overlay could never shrink
      // back down — the measurement would just echo the window size.
      const height = el.offsetHeight;
      if (height <= 0 || Math.abs(height - requested) < 1) return;
      requested = height;
      void invoke<number>("resize_overlay", { height });
    };
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    apply();
    return () => observer.disconnect();
  }, [ref]);
}
