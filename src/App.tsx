import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createNote, getVaultDir } from "./lib/vault";
import { homeDir, tauriVaultFs } from "./lib/vault-fs";
import "./App.css";

function App() {
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const vaultDirRef = useRef<string | null>(null);
  const savingRef = useRef(false);

  // Resolve the vault dir once at startup.
  useEffect(() => {
    void (async () => {
      vaultDirRef.current = await getVaultDir(tauriVaultFs, await homeDir());
    })();
  }, []);

  // Re-focus the input whenever the overlay window is shown/focused.
  useEffect(() => {
    const focus = () => textareaRef.current?.focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);

  const save = useCallback(async (text: string) => {
    // Guard: empty (or whitespace-only) input creates no file.
    if (text.trim() === "") return;
    if (savingRef.current) return; // no double-save on repeated Enter
    savingRef.current = true;
    try {
      const vaultDir = vaultDirRef.current ?? (await getVaultDir(tauriVaultFs, await homeDir()));
      vaultDirRef.current = vaultDir;
      // createNote awaits the write: the file is on disk before we continue.
      await createNote(tauriVaultFs, vaultDir, { body: text, kind: "note" });
      setBody("");
      void invoke("hide_overlay");
    } catch (err) {
      console.error("capture failed:", err);
    } finally {
      savingRef.current = false;
    }
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter saves; Shift+Enter falls through to insert a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void save(body);
    }
  };

  return (
    <main className="overlay">
      <textarea
        ref={textareaRef}
        className="overlay-input"
        placeholder="Type a note… (markdown, Enter to save)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        spellCheck={false}
        rows={3}
      />
    </main>
  );
}

export default App;
