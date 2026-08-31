// Setup view (T6, extended in T5): the first-run wizard and the tray's
// "Settings…" panel — one component, two modes (see src/lib/settings-flow.ts
// for the pure rules it renders).
//
//   wizard (firstRun): step 1 picks the vault folder — unchanged T6 behaviour
//   (Obsidian-registry suggestion prefilled, Enter confirms via set_vault_dir,
//   Esc swallowed) — then step 2 picks the AI provider/model, preselected
//   claude / claude-haiku-4-5 so Enter, Enter on a fresh machine saves the
//   defaults and lands in capture.
//
//   settings (tray): header (icon, name, version from the build), the Vault
//   section prefilled with the CONFIGURED path, and the AI section — all
//   visible at once. Enter saves only what changed, Esc closes.
//
// Probes run ONCE per open of the AI section: claude_auth_status costs a real
// model call (T2 audit), so a ref guards it against re-renders and
// StrictMode's double effect; ollama_status rides the same guard. Both render
// as "checking…" until they land.
//
// Save sequencing (T2 audit): set_vault_dir, set_llm_config and
// set_autostart all read-modify-write config.json and must never run
// concurrently. Both modes await their ordered action lists one at a time —
// vault strictly first, autostart last ("Launch at login": wizard default
// CHECKED and always saved on completion; settings seeded from the live
// get_autostart and saved only when toggled).

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { suggestVaultPath } from "../lib/obsidian-vaults";
import { getVaultDir } from "../lib/vault";
import { homeDir, tauriVaultFs } from "../lib/vault-fs";
import { useFocusOnOverlayShown } from "../lib/overlay";
import {
  WIZARD_AUTOSTART_DEFAULT,
  escCloses,
  fieldOrder,
  initialLlmChoice,
  initialWizard,
  canSaveLlm,
  modelListing,
  nextField,
  providerSelectable,
  savePlan,
  selectedModel,
  withModel,
  withProvider,
  wizardConfirm,
  type LlmChoice,
  type OllamaProbe,
  type ProviderId,
  type SettingsField,
  type WizardState,
} from "../lib/settings-flow";
import appIcon from "../../src-tauri/icons/128x128.png";

/** Obsidian's vault registry, relative to home. */
const OBSIDIAN_REGISTRY = "Library/Application Support/obsidian/obsidian.json";

/** `claude_auth_status` result; null while the probe is in flight. */
interface ClaudeStatus {
  authenticated: boolean;
  detail: string | null;
}

interface SetupViewProps {
  /** First run: no vault configured yet, so Esc cannot cancel out. */
  firstRun: boolean;
  /**
   * A vault path was saved and applied (set_vault_dir succeeded). Awaited:
   * the caller re-resolves its own vault dir before we continue, so nothing
   * typed right after confirming can race into the old one.
   */
  onVaultApplied: () => void | Promise<void>;
  /** Wizard finished / settings saved: back to capture (first run cleared). */
  onDone: () => void;
  /** Back to the capture view (Esc; ignored while firstRun). */
  onClose: () => void;
}

export function SetupView({ firstRun, onVaultApplied, onDone, onClose }: SetupViewProps) {
  const mode = firstRun ? "wizard" : "settings";
  const [wizard, setWizard] = useState<WizardState>(initialWizard);

  // null until the prefill resolves, so a slow read never lets the user
  // confirm an empty path that a late prefill then overwrites.
  const [path, setPath] = useState<string | null>(null);
  const [initialPath, setInitialPath] = useState("");
  const [llm, setLlm] = useState<LlmChoice>(() => initialLlmChoice(null));
  const [initialLlm, setInitialLlm] = useState<{ provider: string; model: string } | null>(null);

  // "Launch at login". Wizard: default CHECKED, so Enter-Enter enables it.
  // Settings: the box must never show a value that didn't come from the
  // get_autostart probe (live plugin state) — it starts UNCHECKED and
  // DISABLED, the probe seeds both states, a failed probe leaves it disabled
  // and puts the failure on the error line, and savePlan treats a null
  // initial as "no change", so an untouched box (or a fast Enter before the
  // probe lands) can never emit a set_autostart.
  const [autostart, setAutostart] = useState(firstRun ? WIZARD_AUTOSTART_DEFAULT : false);
  const [initialAutostart, setInitialAutostart] = useState<boolean | null>(null);
  const autostartDisabled = mode === "settings" && initialAutostart === null;

  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [ollamaProbe, setOllamaProbe] = useState<OllamaProbe | null>(null);
  const [version, setVersion] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const vaultRef = useRef<HTMLInputElement>(null);
  const providerRef = useRef<HTMLSelectElement>(null);
  const modelRef = useRef<HTMLSelectElement>(null);
  const autostartRef = useRef<HTMLInputElement>(null);

  // Reopen focus goes to the first rendered field: the vault input, or — on
  // the wizard's AI step, where no vault input exists — the provider select.
  const firstField = useMemo(
    () => ({
      get current(): HTMLElement | null {
        return vaultRef.current ?? providerRef.current;
      },
    }),
    []
  );
  useFocusOnOverlayShown(firstField as RefObject<HTMLElement>);

  // Prefill. Wizard: the Obsidian-registry suggestion (unchanged from T6 —
  // see suggestVaultPath). Settings: the CONFIGURED state — current vault
  // dir and saved llm config — so savePlan can tell what actually changed.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const home = await homeDir();
      if (firstRun) {
        let registry: unknown = null;
        try {
          registry = JSON.parse(await tauriVaultFs.readFile(`${home}/${OBSIDIAN_REGISTRY}`));
        } catch {
          // no obsidian.json (or unparseable): suggestVaultPath falls back
        }
        if (!cancelled) setPath(suggestVaultPath(registry, home));
        return;
      }
      const dir = await getVaultDir(tauriVaultFs, home);
      const cfg = await invoke<{ provider: string; model: string }>("get_llm_config");
      if (cancelled) return;
      setPath(dir);
      setInitialPath(dir);
      setLlm(initialLlmChoice(cfg));
      setInitialLlm(cfg);
    })().catch((err) => console.error("settings prefill failed:", err));
    return () => {
      cancelled = true;
    };
  }, [firstRun]);

  // Header version (settings only): read from the build, never hardcoded.
  useEffect(() => {
    if (firstRun) return;
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, [firstRun]);

  // Provider probes, ONCE per open of the AI section (wizard: when step 2
  // appears; settings: on mount). claude_auth_status spends a real model
  // call, so the ref guard keeps re-renders and StrictMode's doubled effect
  // from ever firing it twice.
  const aiVisible = !firstRun || wizard.step === "ai";
  const probedRef = useRef(false);
  useEffect(() => {
    if (!aiVisible || probedRef.current) return;
    probedRef.current = true;
    void invoke<ClaudeStatus>("claude_auth_status")
      .then(setClaudeStatus)
      .catch((err) => setClaudeStatus({ authenticated: false, detail: String(err) }));
    void invoke<OllamaProbe>("ollama_status")
      .then(setOllamaProbe)
      .catch(() => setOllamaProbe({ reachable: false, models: [] }));
    // Settings only: seed the checkbox from the LIVE plugin state, not the
    // stored config; until then it stays unchecked and disabled. A failed
    // probe leaves initialAutostart null (box disabled, savePlan skips it)
    // and surfaces on the error line. The wizard keeps its default-checked
    // box instead — nothing is registered yet on first run.
    if (!firstRun) {
      void invoke<boolean>("get_autostart")
        .then((enabled) => {
          setAutostart(enabled);
          setInitialAutostart(enabled);
        })
        .catch((err) => {
          console.error("get_autostart failed:", err);
          setError(`get_autostart failed: ${String(err)}`);
        });
    }
  }, [aiVisible, firstRun]);

  // Advancing to the wizard's AI step swaps the field set; focus follows.
  useEffect(() => {
    if (firstRun && wizard.step === "ai") providerRef.current?.focus();
  }, [firstRun, wizard.step]);

  const listing = modelListing(llm.provider, ollamaProbe);
  const order = fieldOrder(mode, wizard.step);
  const refs: Record<SettingsField, RefObject<HTMLElement | null>> = {
    vault: vaultRef,
    provider: providerRef,
    model: modelRef,
    autostart: autostartRef,
  };

  const fieldOf = (target: EventTarget | null): SettingsField | null =>
    target === vaultRef.current
      ? "vault"
      : target === providerRef.current
        ? "provider"
        : target === modelRef.current
          ? "model"
          : target === autostartRef.current
            ? "autostart"
            : null;

  /** Focus the next field in order, skipping any not currently rendered
   *  (the model select is a note line when there is nothing to pick) or
   *  disabled (the settings checkbox before the get_autostart probe lands —
   *  a disabled input can't take focus, so Tab must not dead-end on it). */
  const focusNext = (from: SettingsField, delta: 1 | -1) => {
    const focusable = (f: SettingsField) => {
      const el = refs[f].current;
      return el !== null && !(el as HTMLInputElement | HTMLSelectElement).disabled;
    };
    let f = nextField(order, from, delta);
    for (let i = 0; i < order.length && !focusable(f); i++) f = nextField(order, f, delta);
    refs[f].current?.focus();
  };

  /** Switch provider; an empty ollama slot adopts the probe's first model so
   *  the dropdown is never on a value it doesn't contain. */
  const pickProvider = (p: ProviderId) => {
    let next = withProvider(llm, p);
    const opts = modelListing(p, ollamaProbe).options;
    if (selectedModel(next) === "" && opts.length > 0) next = withModel(next, opts[0]);
    setLlm(next);
  };

  /** Enter. Wizard: one save per step (vault → advance; ai → done).
   *  Settings: the savePlan actions awaited ONE AT A TIME, vault first —
   *  set_vault_dir and set_llm_config must never run concurrently. */
  /** One save action, awaited to completion before the caller dispatches the
   *  next — this sequencing is what keeps the two config.json writers apart. */
  const runAction = async (action: ReturnType<typeof wizardConfirm>["actions"][number]) => {
    if (action.cmd === "set_vault_dir") {
      await invoke("set_vault_dir", { path: action.path });
      await onVaultApplied();
    } else if (action.cmd === "set_autostart") {
      await invoke("set_autostart", { enabled: action.enabled });
    } else {
      await invoke("set_llm_config", { provider: action.provider, model: action.model });
    }
  };

  const confirm = async () => {
    if (saving) return;
    if (path === null || path.trim() === "") return;
    setSaving(true);
    setError(null);
    try {
      if (firstRun) {
        const { state: next, actions } = wizardConfirm(wizard, {
          vaultPath: path,
          llm,
          autostart,
        });
        if (actions.some((a) => a.cmd === "set_llm_config") && !canSaveLlm(llm)) {
          setError("pick a model first");
          return;
        }
        for (const action of actions) await runAction(action);
        setWizard(next);
        if (next.done) onDone();
        return;
      }
      const plan = savePlan({
        initialVaultPath: initialPath,
        vaultPath: path,
        initialLlm,
        llm,
        initialAutostart,
        autostart,
      });
      // Guard only a save that would actually write the llm config: a
      // vault-only change must not be held hostage by an unpicked model.
      if (plan.some((a) => a.cmd === "set_llm_config" && a.model === "")) {
        setError("pick a model first");
        return;
      }
      for (const action of plan) await runAction(action);
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
      if (escCloses(mode)) onClose();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      focusNext(fieldOf(event.target) ?? order[0], event.shiftKey ? -1 : 1);
      return;
    }
    // Arrows move between fields from the vault input; inside the selects
    // they keep their native meaning (change the selected option).
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && order.length > 1) {
      if (fieldOf(event.target) === "vault") {
        event.preventDefault();
        focusNext("vault", event.key === "ArrowDown" ? 1 : -1);
      }
    }
  };

  const claudeLine =
    claudeStatus === null ? (
      <span className="settings-note">checking…</span>
    ) : claudeStatus.authenticated ? (
      <span className="field-parse">authenticated</span>
    ) : (
      <span className="field-parse field-parse-bad">
        not authenticated{claudeStatus.detail ? ` — ${claudeStatus.detail}` : ""}
      </span>
    );
  const ollamaLine =
    ollamaProbe === null ? (
      <span className="settings-note">checking…</span>
    ) : ollamaProbe.reachable ? (
      <span className="field-parse">
        running · {ollamaProbe.models.length} model{ollamaProbe.models.length === 1 ? "" : "s"}
      </span>
    ) : (
      <span className="field-parse field-parse-bad">not running</span>
    );

  const hint = firstRun
    ? wizard.step === "vault"
      ? "choose where stash keeps your notes — Enter confirms"
      : "pick your AI — Enter confirms, defaults are fine"
    : "Enter saves, Esc cancels";

  return (
    <div className="setup-view" onKeyDown={onKeyDown}>
      {mode === "settings" && (
        <div className="settings-header">
          <img className="settings-icon" src={appIcon} alt="" />
          <span className="settings-name">stash</span>
          <span className="settings-version">{version === "" ? "" : `v${version}`}</span>
        </div>
      )}

      {(mode === "settings" || wizard.step === "vault") && (
        <div className="field-editor">
          <span className="field-label">vault</span>
          <input
            ref={vaultRef}
            className="field-input"
            value={path ?? ""}
            onChange={(e) => setPath(e.target.value)}
            placeholder="path to your vault folder"
            autoFocus
            spellCheck={false}
            aria-label="vault folder"
          />
        </div>
      )}

      {aiVisible && (
        <>
          <div className="field-editor">
            <span className="field-label">ai</span>
            <select
              ref={providerRef}
              className="settings-select"
              value={llm.provider}
              onChange={(e) => pickProvider(e.target.value as ProviderId)}
              aria-label="ai provider"
            >
              <option value="claude">Claude</option>
              <option value="ollama" disabled={!providerSelectable("ollama", ollamaProbe)}>
                Ollama
              </option>
            </select>
            {listing.options.length > 0 ? (
              <select
                ref={modelRef}
                className="settings-select"
                value={selectedModel(llm)}
                onChange={(e) => setLlm(withModel(llm, e.target.value))}
                aria-label="ai model"
              >
                {listing.options.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <span className="settings-note">{listing.note}</span>
            )}
          </div>
          <div className="settings-status">
            <div>claude — {claudeLine}</div>
            <div>ollama — {ollamaLine}</div>
          </div>
          <div className="field-editor">
            <span className="field-label">startup</span>
            <label className="settings-check">
              <input
                ref={autostartRef}
                type="checkbox"
                checked={autostart}
                disabled={autostartDisabled}
                onChange={(e) => setAutostart(e.target.checked)}
                aria-label="launch at login"
              />
              Launch at login
            </label>
          </div>
        </>
      )}

      <div className="tasks-empty under-input">{error ?? hint}</div>
    </div>
  );
}
