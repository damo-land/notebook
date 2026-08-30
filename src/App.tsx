import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  createNote,
  getVaultDir,
  listNotes,
  readNote,
  updateNote,
  type Note,
  type NoteKind,
} from "./lib/vault";
import { homeDir, tauriVaultFs } from "./lib/vault-fs";
import { parseDateEntry, parseDateTimeEntry } from "./lib/date-entry";
import { onOpenNote } from "./lib/note-editor-bus";
import {
  dismissOverlay,
  useFocusOnOverlayShown,
  useOverlayAutoHeight,
  useOverlayMotion,
  OVERLAY_HIDDEN_EVENT,
} from "./lib/overlay";
import { ChatView, type ChatTurn } from "./components/chat-view";
import { CommandPalette, type CommandItem } from "./components/command-palette";
import { NoteEditor } from "./components/note-editor";
import { SearchView } from "./components/search-view";
import { TasksView } from "./components/tasks-view";
import "./App.css";

type Mode = "plain" | "task" | "knowledge";
type FieldId = "deadline" | "category" | "alert";

// `/` palette in plain capture. `task`/`knowledge` switch capture mode;
// `search` (T10) and `chat` (T14) switch the view.
const COMMANDS: CommandItem[] = [
  { id: "task", label: "task", hint: "capture a task" },
  { id: "knowledge", label: "knowledge", hint: "capture knowledge" },
  { id: "search", label: "search", hint: "search the vault" },
  { id: "chat", label: "chat", hint: "ask about your notes" },
];

// `/` field selector. Alert (T9) is offered in plain capture too, so a bare
// note can carry a reminder; knowledge mode has no fields in v1.
const ALERT_FIELD: CommandItem = {
  id: "alert",
  label: "alert",
  hint: "fri 9am, tomorrow 14:30, 18:00",
};
const TASK_FIELDS: CommandItem[] = [
  { id: "deadline", label: "deadline", hint: "fri, 2026-09-03, +3d" },
  { id: "category", label: "category", hint: "single tag" },
  ALERT_FIELD,
];
const PLAIN_FIELDS: CommandItem[] = [ALERT_FIELD];

function fieldsForMode(mode: Mode): CommandItem[] {
  if (mode === "task") return TASK_FIELDS;
  if (mode === "plain") return PLAIN_FIELDS;
  return [];
}

/** `shoot_input` return value (src-tauri/src/lib.rs ShootInput). */
interface ShootInput {
  seed: string | null;
  typed: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Guards the screenshot hook's show/hide/show sequence against StrictMode's
 *  double mount. Module scope so it survives the remount. */
let shootSequenceStarted = false;

function App() {
  const [mode, setMode] = useState<Mode>("plain");
  const [body, setBody] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [fieldMenuIndex, setFieldMenuIndex] = useState(0);
  const [editingField, setEditingField] = useState<FieldId | null>(null);
  const [fieldText, setFieldText] = useState("");
  const [deadline, setDeadline] = useState<{ raw: string; iso: string | null } | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  // Alert datetime (T9). Available in plain capture as well as task mode.
  const [alertAt, setAlertAt] = useState<{ raw: string; iso: string | null } | null>(null);
  // Editor view for an existing note. Orthogonal to `mode`: while non-null it
  // replaces the capture UI entirely, so capture's keydown chain (palette,
  // field menu, mode Esc, Enter-saves) is unmounted and cannot fire.
  const [editing, setEditing] = useState<Note | null>(null);
  // Top-level view: capture UI (default), the T8 tasks list, the T10 search
  // box, or the T14 chat window. Orthogonal to `mode` (capture state persists
  // underneath) and below `editing` in render priority — Enter on a row opens
  // the editor over the view, and closing the editor drops back into it.
  const [view, setView] = useState<"capture" | "tasks" | "search" | "chat">("capture");
  // Chat transcript and SDK session id (T14). Held here rather than in
  // ChatView because leaving chat unmounts that component and the criterion
  // keeps the transcript for the session. In memory only — never written to
  // the vault.
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatSession, setChatSession] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLElement>(null);
  const vaultDirRef = useRef<string | null>(null);
  const savingRef = useRef(false);

  // The window follows the rendered content's height, and the appear
  // animation is replayed on every open. Both belong to the shell, so they
  // hang off the one <main> every view renders inside.
  useOverlayAutoHeight(overlayRef);
  useOverlayMotion(overlayRef);
  // Capture's primary input. The other four views focus their own.
  useFocusOnOverlayShown(textareaRef);

  // Palette is derived state: open while plain capture holds a single line
  // starting with "/" (i.e. "/" was typed into an empty input). Clearing the
  // body (Esc) or a newline closes it.
  const paletteOpen = mode === "plain" && body.startsWith("/") && !body.includes("\n");
  const paletteQuery = paletteOpen ? body.slice(1).toLowerCase() : "";
  const paletteItems = COMMANDS.filter((c) => c.label.startsWith(paletteQuery));
  const paletteSelectable = paletteItems.filter((c) => !c.disabled);
  const paletteSelected =
    paletteSelectable[Math.min(paletteIndex, Math.max(paletteSelectable.length - 1, 0))] ?? null;
  const fields = fieldsForMode(mode);
  const fieldSelected = fields[fieldMenuIndex] ?? null;

  // Resolve the vault dir once at startup.
  useEffect(() => {
    void (async () => {
      vaultDirRef.current = await getVaultDir(tauriVaultFs, await homeDir());
    })();
  }, []);

  // Tasks-view hotkey: the Rust handler (TASKS_VIEW_SHORTCUT) shows the
  // panel and emits this event; switch straight to the tasks view, closing
  // any open editor so the list is what the user sees.
  useEffect(() => {
    const unlisten = listen("open-tasks-view", () => {
      setEditing(null);
      setView("tasks");
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  /** Back to plain capture: mode + collected fields discarded, body kept. */
  const resetToPlain = useCallback(() => {
    setMode("plain");
    setFieldMenuOpen(false);
    setFieldMenuIndex(0);
    setEditingField(null);
    setFieldText("");
    setDeadline(null);
    setCategory(null);
    setAlertAt(null);
  }, []);

  // Dismissal discards unsaved input.
  //
  // THIS IS DELIBERATE, NOT A BUG. The overlay used to keep whatever had been
  // typed while it was hidden, so reopening resumed the old draft; the
  // redesign reverses that on purpose (spec: "dismissal discards anything
  // unsaved"), so every open starts from a clean overlay. If you are here
  // because a draft went missing after Esc — that is the specified behaviour.
  // Restore it by deleting this effect, not by patching around it.
  //
  // Rust emits the event from `hide_overlay_panel`, which Esc, Ctrl+W, the
  // alt+space toggle and clicking outside all funnel through — so all four
  // clear identically. The clearing runs while the panel is off screen, so
  // the wipe is never visible.
  //
  // The chat transcript is the one thing kept: T14's criterion holds it for
  // the session, and it is not unsaved input — it is already-sent
  // conversation. It is unreachable from a fresh open anyway, since the view
  // resets to capture.
  useEffect(() => {
    const unlisten = listen(OVERLAY_HIDDEN_EVENT, () => {
      setBody("");
      setPaletteIndex(0);
      resetToPlain(); // mode, field menu, in-progress field text, chips
      setEditing(null); // an open note editor: draft discarded
      setView("capture");
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [resetToPlain]);

  // Grow the capture input to fit its text. `rows={1}` is the floor, so an
  // empty overlay is a single row; each added line makes the element taller,
  // which grows <main>, which the auto-height hook turns into a window resize.
  // Height is cleared before measuring or `scrollHeight` would never shrink.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body, editingField, fieldMenuOpen, view, editing]);

  const save = useCallback(
    async (
      text: string,
      kind: NoteKind,
      opts: { deadline?: string; tags?: string[]; alert?: string } = {}
    ) => {
      // Guard: empty (or whitespace-only) input creates no file.
      if (text.trim() === "") return;
      if (savingRef.current) return; // no double-save on repeated Enter
      savingRef.current = true;
      try {
        const vaultDir = vaultDirRef.current ?? (await getVaultDir(tauriVaultFs, await homeDir()));
        vaultDirRef.current = vaultDir;
        // createNote awaits the write: the file is on disk before we continue.
        await createNote(tauriVaultFs, vaultDir, {
          body: text,
          kind,
          tags: opts.tags,
          deadline: opts.deadline,
          alert: opts.alert,
        });
        setBody("");
        resetToPlain();
        dismissOverlay();
      } catch (err) {
        console.error("capture failed:", err);
      } finally {
        savingRef.current = false;
      }
    },
    [resetToPlain]
  );

  // Open-by-id: T8/T10 (or any code) call openNote(id) from
  // src/lib/note-editor-bus.ts; this subscription reads the note and shows
  // the editor. Capture state (mode, fields, body) is left as-is underneath.
  useEffect(() => {
    return onOpenNote((id) => {
      void (async () => {
        try {
          const vaultDir = vaultDirRef.current ?? (await getVaultDir(tauriVaultFs, await homeDir()));
          vaultDirRef.current = vaultDir;
          setEditing(await readNote(tauriVaultFs, vaultDir, id));
        } catch (err) {
          console.error("open note failed:", err);
        }
      })();
    });
  }, []);

  // Dev-only screenshot hook (scripts/shoot.sh). `shoot_view` returns null in
  // a release build and in every normal dev run, so this effect is a single
  // no-op invoke unless the harness set NOTEBOOK_SHOOT_VIEW. When it did:
  // switch to the requested view and only then ask Rust to show the panel.
  // Showing last is what makes "the panel is on screen" a reliable readiness
  // signal for the harness.
  //
  // `shoot_input` adds the content half, which the height and focus criteria
  // both need and which no unattended run can type (macOS Accessibility is not
  // granted, so there is no keystroke injection): `seed` is placed in the
  // input at mount, and `typed` — if set — makes this hook dismiss and reopen
  // the panel and then insert text at the caret, so one PNG shows whether
  // focus came back and whether the dismissal cleared the seeded draft.
  useEffect(() => {
    void (async () => {
      const target = await invoke<string | null>("shoot_view");
      if (!target) return;
      if (target === "tasks" || target === "search" || target === "chat") {
        setView(target);
      } else if (target === "editor") {
        // The editor only exists for a note that exists: open the first one in
        // the vault. An empty vault is a hard error — the harness then times
        // out waiting for the panel and prints this line from the dev log.
        const vaultDir = vaultDirRef.current ?? (await getVaultDir(tauriVaultFs, await homeDir()));
        vaultDirRef.current = vaultDir;
        const first = (await listNotes(tauriVaultFs, vaultDir))[0];
        if (!first) throw new Error("no note in the vault to open in the editor");
        setEditing(await readNote(tauriVaultFs, vaultDir, first.id));
      }
      const input = await invoke<ShootInput>("shoot_input");
      if (input.seed !== null) setBody(input.seed);

      // StrictMode mounts this effect twice in dev; the show/hide/show
      // sequence below must not be interleaved with a second copy of itself.
      if (shootSequenceStarted) return;
      shootSequenceStarted = true;

      // A timer, not requestAnimationFrame: the panel is still hidden here and
      // a webview in an off-screen window never runs animation frames, so the
      // rAF callback would never fire and the panel would never appear.
      await sleep(100);
      await invoke("shoot_show_overlay");
      if (input.typed === null) return;

      // Reopen proof. Hide the panel the way Esc does, show it again, then
      // insert text — `insertText` goes to the caret of whatever holds DOM
      // focus and nowhere else, so nothing lands unless the reopen actually
      // restored focus. The seeded text is gone by then because the hide
      // cleared it. Both criteria, one image.
      await sleep(700);
      await invoke("hide_overlay");
      await sleep(400);
      await invoke("shoot_show_overlay");
      await sleep(400);
      document.execCommand("insertText", false, input.typed);
    })().catch((err) => console.error("shoot hook failed:", err));
  }, []);

  /** Persist the edited body via updateNote, then back to capture. The
   *  overlay stays visible: editing is deliberate context, unlike quick
   *  capture where save dismisses the window. */
  const saveEdit = useCallback(
    async (note: Note, newBody: string) => {
      if (newBody.trim() === "") return; // don't wipe a note to empty
      if (savingRef.current) return;
      savingRef.current = true;
      try {
        const vaultDir = vaultDirRef.current ?? (await getVaultDir(tauriVaultFs, await homeDir()));
        vaultDirRef.current = vaultDir;
        await updateNote(tauriVaultFs, vaultDir, note.id, { replaceBody: newBody });
        setEditing(null); // back to plain capture, overlay stays up
      } catch (err) {
        console.error("save note failed:", err);
      } finally {
        savingRef.current = false;
      }
    },
    []
  );

  const enterMode = (next: Mode) => {
    setMode(next);
    setBody(""); // the "/command" text was palette input, not note body
    setPaletteIndex(0);
    textareaRef.current?.focus();
  };

  /** Run the selected palette command: a capture mode, or a view switch. */
  const runCommand = (id: string) => {
    if (id === "search" || id === "chat") {
      // Clearing the body matters: the "/search" (or "/chat") text was palette
      // input, and leaving it would land Esc-back-from-the-view in an open
      // palette.
      setBody("");
      setPaletteIndex(0);
      setView(id);
      return;
    }
    enterMode(id as Mode);
  };

  const onBodyKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 1. Palette navigation (plain capture, menu open).
    if (paletteOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const n = paletteSelectable.length;
        if (n > 0) {
          setPaletteIndex((i) => (event.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (paletteSelected) runCommand(paletteSelected.id);
        return; // no selectable command -> Enter is a no-op, nothing saved
      }
      if (event.key === "Escape") {
        // Close the palette (clearing the "/") — keep the overlay visible.
        event.preventDefault();
        event.stopPropagation();
        setBody("");
        setPaletteIndex(0);
        return;
      }
      return;
    }

    // 2. In-mode field selector navigation.
    if (fieldMenuOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const n = fields.length;
        if (n > 0) {
          setFieldMenuIndex((i) => (event.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (fieldSelected) {
          setEditingField(fieldSelected.id as FieldId);
          setFieldText("");
        }
        setFieldMenuOpen(false);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setFieldMenuOpen(false);
        return;
      }
      return;
    }

    // 3. Esc inside a mode: back to plain capture, nothing saved. The overlay
    // stays up — preventDefault/stopPropagation keep the global keymap
    // (which hides the window) out of it. Plain mode falls through to it.
    if (event.key === "Escape" && mode !== "plain") {
      event.preventDefault();
      event.stopPropagation();
      resetToPlain();
      return;
    }

    // 4. "/" at a line start opens the field selector, in every mode that has
    // fields (task: deadline/category/alert; plain: alert). ONE exception,
    // which keeps T2's command palette reachable: in plain mode a "/" typed
    // into a completely empty input is the COMMAND palette (mode switch), so
    // the palette owns that single keystroke and every other line-start "/"
    // opens the field selector.
    if (event.key === "/" && fields.length > 0) {
      const el = event.currentTarget;
      const pos = el.selectionStart;
      const atLineStart = el.selectionEnd === pos && (pos === 0 || body[pos - 1] === "\n");
      const opensCommandPalette = mode === "plain" && body === "";
      if (atLineStart && !opensCommandPalette) {
        event.preventDefault();
        setFieldMenuOpen(true);
        setFieldMenuIndex(0);
        return;
      }
    }

    // 5. Enter saves; Shift+Enter falls through to insert a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // Unparsed field text is never saved (the chip shows it as unparsed).
      const alert = alertAt?.iso ?? undefined;
      if (mode === "plain") {
        void save(body, "note", { alert });
      } else {
        void save(body, mode, {
          deadline: deadline?.iso ?? undefined,
          tags: category ? [category] : undefined,
          alert,
        });
      }
    }
  };

  const closeFieldEditor = () => {
    setEditingField(null);
    setFieldText("");
    textareaRef.current?.focus();
  };

  const onFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const text = fieldText.trim();
      if (editingField === "deadline") {
        setDeadline(text === "" ? null : { raw: text, iso: parseDateEntry(text) });
      } else if (editingField === "alert") {
        setAlertAt(text === "" ? null : { raw: text, iso: parseDateTimeEntry(text) });
      } else if (editingField === "category") {
        setCategory(text === "" ? null : text);
      }
      closeFieldEditor();
      return;
    }
    if (event.key === "Escape") {
      // Discard this field's in-progress text; stay in the mode.
      event.preventDefault();
      event.stopPropagation();
      closeFieldEditor();
    }
  };

  const fieldParsed =
    editingField === "deadline"
      ? parseDateEntry(fieldText)
      : editingField === "alert"
        ? parseDateTimeEntry(fieldText)
        : null;

  // One <main> for every view, rather than a `<main>` per early return: it is
  // the element whose height drives the window, the element the appear
  // animation runs on, and it must survive a view switch for either to work.
  const content = editing ? (
    <NoteEditor
      key={editing.path} // remount (fresh draft) when a different note opens
      note={editing}
      onSave={(newBody) => void saveEdit(editing, newBody)}
      onClose={() => setEditing(null)} // Esc: discard draft, back to capture
    />
  ) : view === "tasks" ? (
    <TasksView onClose={() => setView("capture")} />
  ) : view === "search" ? (
    <SearchView onClose={() => setView("capture")} />
  ) : view === "chat" ? (
    <ChatView
      turns={chatTurns}
      setTurns={setChatTurns}
      session={chatSession}
      setSession={setChatSession}
      onClose={() => setView("capture")} // transcript survives in App state
    />
  ) : (
    <div className="capture">
      {(mode !== "plain" || alertAt) && (
        <div className="chips">
          {mode !== "plain" && <span className={`chip chip-kind chip-${mode}`}>{mode}</span>}
          {deadline &&
            (deadline.iso ? (
              <span className="chip">deadline {deadline.iso}</span>
            ) : (
              <span className="chip chip-invalid">deadline "{deadline.raw}" unparsed</span>
            ))}
          {alertAt &&
            (alertAt.iso ? (
              <span className="chip">alert {alertAt.iso}</span>
            ) : (
              <span className="chip chip-invalid">alert "{alertAt.raw}" unparsed</span>
            ))}
          {category && <span className="chip">#{category}</span>}
          {fields.length > 0 && !editingField && !fieldMenuOpen && (
            <span className="chip-hint">/ for {fields.map((f) => f.label).join(" · ")}</span>
          )}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="overlay-input"
        placeholder={
          mode === "plain"
            ? "Type a note… (markdown, Enter to save, / for commands)"
            : `Describe the ${mode}… (Enter to save, Esc to cancel)`
        }
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setPaletteIndex(0); // typing re-filters: selection back to top
        }}
        onKeyDown={onBodyKeyDown}
        autoFocus
        spellCheck={false}
        // One row is the floor, not the size: the effect above sets the
        // element's height from its content on every change.
        rows={1}
      />
      {paletteOpen && (
        <CommandPalette items={paletteItems} selectedId={paletteSelected?.id ?? null} />
      )}
      {fieldMenuOpen && (
        <CommandPalette items={fields} selectedId={fieldSelected?.id ?? null} />
      )}
      {editingField && (
        <div className="field-editor">
          <span className="field-label">{editingField}</span>
          <input
            className="field-input"
            value={fieldText}
            onChange={(e) => setFieldText(e.target.value)}
            onKeyDown={onFieldKeyDown}
            placeholder={
              editingField === "deadline"
                ? "fri · 2026-09-03 · +3d"
                : editingField === "alert"
                  ? "fri 9am · tomorrow 14:30 · 18:00"
                  : "tag name"
            }
            autoFocus
            spellCheck={false}
          />
          {editingField !== "category" && fieldText.trim() !== "" && (
            <span className={fieldParsed ? "field-parse" : "field-parse field-parse-bad"}>
              {fieldParsed ? `${fieldText.trim()} → ${fieldParsed}` : "unparsed"}
            </span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <main ref={overlayRef} className="overlay overlay-motion">
      {content}
    </main>
  );
}

export default App;
