// Which top-level view the overlay opens in (T3, stash-installable-app).
//
// Every dismissal resets the frontend for the next open, and until now that
// reset was unconditionally "capture" — which is how a chat conversation
// became unreachable: the transcript survived in App state, but a fresh open
// always landed in capture. The rule now: a non-empty transcript means the
// next open resumes the conversation; an empty one means capture, exactly as
// before.
//
// Pure and DOM-free on purpose, like the other reducers in src/lib/ (see
// chat-transcript.ts): App applies it inside the overlay-hidden reset, and
// scripts/view-restore-demo.ts proves it without a DOM.

/** The two views an overlay open can start in. */
export type RestoredView = "capture" | "chat";

/**
 * The view the next overlay open starts from, decided at reset time: back
 * into the chat conversation while a transcript exists, plain capture
 * otherwise.
 */
export function restoreView(state: { transcriptEmpty: boolean }): RestoredView {
  return state.transcriptEmpty ? "capture" : "chat";
}
