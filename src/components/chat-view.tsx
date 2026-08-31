// Chat view (T14): `/chat` morphs the capture overlay into a chat window — a
// scrolling transcript above, a one-line message input below, keyboard only.
//
// Keys: Enter sends (ignored while an answer is in flight); Esc leaves chat
// and returns to capture with the overlay still up; Ctrl+W hides the overlay
// and leaves chat.
//
// Where the transcript lives: in App state, passed in as props. Every other
// view in this app (T8 tasks, T10 search) deliberately remounts and forgets
// itself, but "transcript kept for session" is an acceptance criterion here,
// so the turns have to outlive this component. They are NEVER written to the
// vault — no note is created, nothing is persisted; the transcript dies with
// the app process. (The Agent SDK does keep its own session transcript under
// ~/.claude/projects/, which is how continuity works — outside the vault.)
//
// Streaming: `chat_send` returns only when the whole answer is ready, but the
// sidecar emits each text delta as a `chat-chunk` Tauri event on the way. The
// answer is appended to the transcript as an empty, `streaming` turn up front
// and filled in by those events, then overwritten with the authoritative
// final text when the command resolves. That overwrite is load-bearing, not
// cosmetic: the deltas are every assistant text delta of the turn, so they can
// include something the model said before it reached for Grep or Read, while
// the returned text is the final assistant turn alone. The stream is a
// preview; `reply.text` is the answer. Both reducers live in
// src/lib/chat-transcript.ts so that contract is provable without a DOM.

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appendDelta, finishTurn, type ChatTurn } from "../lib/chat-transcript";
import { dismissOverlay, useFocusOnOverlayShown } from "../lib/overlay";

export type { ChatTurn };

/**
 * Stable prefix of the sidecar's NotAuthenticatedError message
 * (sidecar/src/llm.ts), passed through main.ts and chat_send as the error
 * string. Matching it here is what turns a raw auth failure into guidance
 * instead of an error dump (T9 graceful degradation).
 */
const NOT_AUTHENTICATED = "Not authenticated with Claude Code";

/** What the transcript shows instead of a raw auth error. */
const LLM_NOT_CONFIGURED =
  "The LLM is not configured — run `claude setup-token` in a terminal to " +
  "connect your Claude account, then try again.";

/** `chat_send` return value (src-tauri/src/lib.rs ChatReply). */
interface ChatReply {
  text: string;
  /** SDK session id, echoed back on the next turn to continue the conversation. */
  session: string | null;
}

/** `chat-chunk` event payload (one streamed text delta). */
interface ChatChunk {
  turn: string | null;
  text: string;
}

// Module scope, not component state, and deliberately so: leaving chat (Esc)
// unmounts this component while the turn it started keeps running in the
// sidecar. The id labelling that turn's chunks must survive, so that coming
// back mid-answer resumes rendering the stream instead of dropping it — and so
// that late chunks from a turn that already timed out are never appended to a
// newer one.
let nextTurnId = 0;
let activeTurn: string | null = null;

interface ChatViewProps {
  /** The session transcript, oldest first. Owned by App. */
  turns: ChatTurn[];
  setTurns: React.Dispatch<React.SetStateAction<ChatTurn[]>>;
  /** SDK session id of the conversation so far; null before the first turn. */
  session: string | null;
  setSession: (session: string | null) => void;
  /** Back to the capture view (Esc; also after Ctrl+W hides the overlay). */
  onClose: () => void;
}

export function ChatView({ turns, setTurns, session, setSession, onClose }: ChatViewProps) {
  const [draft, setDraft] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // One turn in flight at a time. Derived from the transcript rather than held
  // in local state, so it is still true after leaving and re-entering chat
  // while an answer is being written.
  const busy = turns[turns.length - 1]?.streaming === true;

  // Streamed deltas append to the answer currently being written.
  useEffect(() => {
    const unlisten = listen<ChatChunk>("chat-chunk", (event) => {
      if (event.payload.turn !== activeTurn) return; // a turn we no longer track
      setTurns((prev) => appendDelta(prev, event.payload.text));
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [setTurns]);

  // This view's primary input: focused on mount and on every reopen.
  useFocusOnOverlayShown(inputRef);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  /** Replace the in-progress answer with its final text (or an error note). */
  const finish = (text: string) => {
    setTurns((prev) => finishTurn(prev, text));
  };

  const send = async (text: string) => {
    const turn = String((nextTurnId += 1));
    activeTurn = turn;
    setTurns((prev) => [
      ...prev,
      { role: "you", text },
      { role: "notebook", text: "", streaming: true },
    ]);
    try {
      const reply = await invoke<ChatReply>("chat_send", { text, session, turn });
      setSession(reply.session);
      // Authoritative: also repairs a partial or over-long stream — deltas
      // missed while this view was unmounted, and anything the model said
      // before it went searching, which streamed but is not the answer.
      finish(reply.text);
    } catch (err) {
      const message = String(err);
      console.error("chat failed:", message);
      finish(
        message.includes(NOT_AUTHENTICATED)
          ? LLM_NOT_CONFIGURED
          : `(chat failed: ${message})`,
      );
    } finally {
      if (activeTurn === turn) activeTurn = null;
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const text = draft.trim();
      if (text === "" || busy) return; // no empty sends, no overlapping turns
      setDraft("");
      void send(text);
      return;
    }
    if (event.key === "Escape") {
      // Leave chat; the overlay stays up and the transcript is kept.
      // preventDefault keeps the global keymap (which hides the window) out.
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "w") {
      // Hide the overlay AND leave chat. The transcript survives, so App's
      // overlay-hidden reset (restoreView, T3) puts the next open straight
      // back into the conversation.
      event.preventDefault();
      dismissOverlay();
      onClose();
    }
  };

  return (
    <div className="chat-view">
      <div className="chat-transcript" role="log" aria-label="chat transcript">
        {turns.length === 0 ? (
          <div className="tasks-empty">ask about your notes</div>
        ) : (
          turns.map((turn, i) => (
            <div key={i} className={`chat-turn chat-turn-${turn.role}`}>
              <span className="chat-role">{turn.role}</span>
              <span className="chat-text">
                {turn.text}
                {turn.streaming === true && <span className="chat-caret">▍</span>}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <input
        ref={inputRef}
        className="overlay-input chat-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={busy ? "Answering…" : "Ask your notes…"}
        autoFocus
        spellCheck={false}
        aria-label="chat message"
      />
    </div>
  );
}
