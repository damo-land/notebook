// Setup view (T6): the first-run wizard and the tray's "Settings…" panel —
// one view, one job: pick the vault folder.
//
// The path input is pre-filled with a suggestion: Obsidian's vault registry
// (~/Library/Application Support/obsidian/obsidian.json, read through the
// plain vault_read_file bridge — a missing file just fails the read) is
// parsed and handed to the pure suggestVaultPath rule, which prefers a
// `stash/` folder inside the open Obsidian vault and falls back to ~/Stash.
// The user can type any path over it.
//
// Enter confirms: the set_vault_dir command writes ~/.config/stash/config.json,
// creates the directory, and re-points the RUNNING app (in-memory vault dir +
// reindex), so no restart is needed. Esc goes back to capture — except on
// first run, where there is no configured vault to fall back to, so Esc is
// swallowed and the wizard stays up.

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { suggestVaultPath } from "../lib/obsidian-vaults";
import { homeDir, tauriVaultFs } from "../lib/vault-fs";
import { useFocusOnOverlayShown } from "../lib/overlay";

/** Obsidian's vault registry, relative to home. */
const OBSIDIAN_REGISTRY = "Library/Application Support/obsidian/obsidian.json";

interface SetupViewProps {
  /** First run: no vault configured yet, so Esc cannot cancel out. */
  firstRun: boolean;
  /**
   * Vault confirmed and applied (set_vault_dir succeeded). Awaited: the view
   * stays in its saving state until the caller has re-resolved its own vault
   * dir, so nothing typed right after confirming can race into the old one.
   */
  onDone: () => void | Promise<void>;
  /** Back to the capture view (Esc; ignored while firstRun). */
  onClose: () => void;
}

export function SetupView({ firstRun, onDone, onClose }: SetupViewProps) {
  // null until the suggestion resolves, so a slow read never lets the user
  // confirm an empty path that a late suggestion then overwrites.
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  useFocusOnOverlayShown(inputRef);

  // Pre-fill with the suggested vault path (see the file comment).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const home = await homeDir();
      let registry: unknown = null;
      try {
        registry = JSON.parse(await tauriVaultFs.readFile(`${home}/${OBSIDIAN_REGISTRY}`));
      } catch {
        // no obsidian.json (or unparseable): suggestVaultPath falls back
      }
      if (!cancelled) setPath(suggestVaultPath(registry, home));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const confirm = async () => {
    if (path === null || path.trim() === "" || saving) return;
    setSaving(true);
    setError(null);
    try {
      await invoke("set_vault_dir", { path });
      await onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void confirm();
      return;
    }
    if (event.key === "Escape") {
      // preventDefault keeps the global keymap (which hides the window) out
      // of it — on first run Esc must do nothing at all: there is no vault
      // to fall back to, so the wizard stays up.
      event.preventDefault();
      event.stopPropagation();
      if (!firstRun) onClose();
    }
  };

  return (
    <div className="setup-view">
      <div className="field-editor">
        <span className="field-label">vault</span>
        <input
          ref={inputRef}
          className="field-input"
          value={path ?? ""}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="path to your vault folder"
          autoFocus
          spellCheck={false}
          aria-label="vault folder"
        />
      </div>
      <div className="tasks-empty under-input">
        {error ??
          (firstRun
            ? "choose where stash keeps your notes — Enter confirms"
            : "vault folder — Enter confirms, Esc cancels")}
      </div>
    </div>
  );
}
