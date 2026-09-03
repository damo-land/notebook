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
import Markdown, { type Components } from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appendDelta, finishTurn, type ChatTurn } from "../lib/chat-transcript";
import { dismissOverlay, useFocusOnOverlayShown } from "../lib/overlay";
import { aiDisabled } from "../lib/settings-flow";

export type { ChatTurn };

/** What the view shows when the provider is "none" (`--` in Settings): AI is
 *  an explicit off switch, so chat is disabled and says where to turn it on. */
const AI_OFF_CHAT = "AI is off — choose a provider in Settings to chat";

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

/**
 * Stable fragments of the sidecar's typed Ollama errors (sidecar/src/
 * ollama.ts: OllamaNotReachableError, OllamaModelMissingError,
 * OllamaNoModelError). These messages are already written for the user
 * ("Ollama is not reachable. Is the Ollama app running at localhost:11434?",
 * "Ollama model missing: X — pull it or pick another in Settings"), so they
 * go into the transcript verbatim rather than wrapped as a raw failure. Keep
 * in sync with OLLAMA_NOT_REACHABLE_PREFIX / OLLAMA_MODEL_MISSING_SUFFIX /
 * OLLAMA_NO_MODEL_MESSAGE.
 */
const OLLAMA_GUIDANCE_FRAGMENTS = [
  "Ollama is not reachable",
  "pull it or pick another in Settings",
  "pick one in Settings",
];

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

// Markdown rendering (T1): assistant ("stash") turns only — user turns stay
// plain text. LLM output is untrusted, and two defaults here are load-bearing:
//
// 1. Raw HTML in the markdown is NOT rendered as HTML. react-markdown skips
//    raw HTML nodes by default (they only become live DOM if you add
//    rehype-raw, which this app deliberately does not depend on), so
//    `<script>`, `<img onerror>` etc. in model output render as nothing.
//    No dangerouslySetInnerHTML anywhere.
// 2. Links never navigate the webview. The `a` override below preventDefaults
//    every click and forwards the href to the Rust `open_external` command,
//    which re-validates the scheme (http/https only) before spawning
//    `/usr/bin/open` — so `javascript:`/`file:` hrefs die in Rust even if the
//    markdown produces them. No target=_blank, no default anchor behaviour.
const markdownComponents: Components = {
  a({ href, children }) {
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          if (href !== undefined && href !== "") {
            void invoke("open_external", { url: href }).catch((err) =>
              console.error("open_external failed:", err),
            );
          }
        }}
      >
        {children}
      </a>
    );
  },
};

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

  // Provider "none" = AI off: the input is disabled and NO chat_send is ever
  // invoked, so nothing reaches the sidecar (chat_send refuses too — this
  // gate is the UX, that one is the backstop). Seeded per mount from
  // get_llm_config (a config read, works even while the sidecar boots);
  // false until known so a normal setup never flashes as disabled.
  const [aiOff, setAiOff] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void invoke<{ provider: string }>("get_llm_config")
      .then((cfg) => {
        if (!cancelled) setAiOff(aiDisabled(cfg.provider));
      })
      .catch((err) => console.error("get_llm_config failed:", err));
    return () => {
      cancelled = true;
    };
  }, []);

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
    // The transcript so far, captured BEFORE this turn's rows are appended:
    // the sidecar's ollama provider has no server-side session, so continuity
    // is this replay of the full history each turn. The claude path keeps
    // using `session` (SDK resume) and ignores it.
    const history = turns
      .filter((t) => t.streaming !== true && t.text !== "")
      .map((t) => ({ role: t.role === "you" ? "user" : "assistant", content: t.text }));
    setTurns((prev) => [
      ...prev,
      { role: "you", text },
      { role: "stash", text: "", streaming: true },
    ]);
    try {
      const reply = await invoke<ChatReply>("chat_send", { text, session, turn, history });
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
          : OLLAMA_GUIDANCE_FRAGMENTS.some((f) => message.includes(f))
            ? message
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
      if (text === "" || busy || aiOff) return; // no empty sends, no overlapping turns, no sends while AI is off
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
          <div className="tasks-empty">{aiOff ? AI_OFF_CHAT : "ask about your notes"}</div>
        ) : (
          turns.map((turn, i) => (
            <div key={i} className={`chat-turn chat-turn-${turn.role}`}>
              <span className="chat-role">{turn.role}</span>
              {/* A div, not a span: markdown yields block elements (p, pre,
                  lists) that don't belong inside an inline element. */}
              <div className="chat-text">
                {turn.role === "stash" ? (
                  // Re-rendering the growing string on every streamed delta is
                  // fine at this scale; the final finishTurn text wins anyway.
                  <Markdown components={markdownComponents}>{turn.text}</Markdown>
                ) : (
                  turn.text
                )}
                {turn.streaming === true && <span className="chat-caret">▍</span>}
              </div>
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
        placeholder={aiOff ? AI_OFF_CHAT : busy ? "Answering…" : "Ask your notes…"}
        // Disabled state, via readOnly rather than `disabled`: a disabled
        // input can't hold focus or receive keys, which would break Esc
        // (leave chat) and Ctrl+W. Typing is inert; Enter is gated above.
        readOnly={aiOff}
        aria-disabled={aiOff}
        autoFocus
        spellCheck={false}
        aria-label="chat message"
      />
    </div>
  );
}
