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
// Probes poll while the AI section is open (settings-overhaul T1):
// claude_auth_status and ollama_status re-fire every 4s until each returns a
// definitive result, then every 15s so external changes (daemon stopped,
// token revoked) still surface. A rejected invoke means the SIDECAR is
// unreachable — the sidecar boots asynchronously after app start — which is
// NOT "unauthenticated"/"not running": it renders as "checking…" until the
// first definitive result, and as "sidecar unreachable" if the sidecar drops
// out later. The effect's cleanup clears every pending timer, so nothing
// fires after the view unmounts.
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
  PROVIDER_NONE_LABEL,
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

/** `claude_auth_status` result. */
interface ClaudeStatus {
  authenticated: boolean;
  detail: string | null;
}

/** `ollama_start` result. `error` is set exactly when `started` is false. */
interface OllamaStartResult {
  started: boolean;
  error?: string;
}

/**
 * One provider's probe state. "pending" until the first definitive result
 * (a resolved invoke) lands; a rejected invoke means the sidecar itself is
 * unreachable, which stays "pending" before any definitive result (the
 * sidecar is likely still booting) and becomes "unreachable" after one (the
 * sidecar dropped out — we can no longer say anything about the provider).
 */
type ProbeState<T> =
  | { kind: "pending" }
  | { kind: "unreachable" }
  | { kind: "done"; value: T };

/** Probe cadence: fast until a definitive result, slow afterwards. */
const FAST_POLL_MS = 4000;
const SLOW_POLL_MS = 15000;

/** The command the auth guidance names and copies (settings-overhaul T3). */
const SETUP_TOKEN_CMD = "claude setup-token";

/**
 * Copy the setup command. navigator.clipboard first; a hidden textarea +
 * execCommand("copy") as the fallback for webviews where the async clipboard
 * API is unavailable — no Tauri clipboard plugin dependency needed.
 */
async function copySetupCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText(SETUP_TOKEN_CMD);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = SETUP_TOKEN_CMD;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
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

  const [claudeProbe, setClaudeProbe] = useState<ProbeState<ClaudeStatus>>({ kind: "pending" });
  const [ollamaState, setOllamaState] = useState<ProbeState<OllamaProbe>>({ kind: "pending" });
  // The shape the settings-flow helpers take: null until a definitive probe.
  const ollamaProbe = ollamaState.kind === "done" ? ollamaState.value : null;
  // Start button (T2): busy from click until the daemon answers a re-probe
  // (or the retries run out); a failure renders inline under the status line.
  const [ollamaStarting, setOllamaStarting] = useState(false);
  const [ollamaStartError, setOllamaStartError] = useState<string | null>(null);
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

  // Provider probes, POLLED while the AI section is visible (wizard: step 2;
  // settings: whole open). Each provider loops independently: probe, wait,
  // probe again — re-scheduled only after the previous invoke settles, so
  // probes never overlap even when one hangs to its timeout. Fast cadence
  // until the first definitive result (a resolved invoke — the sidecar boots
  // asynchronously, so early invokes reject with "sidecar unreachable" and
  // must not read as unauthenticated / not running), slow afterwards so
  // external changes (daemon stopped, token revoked) still surface without
  // hammering claude_auth_status, which spends a real model call. The first
  // tick goes through setTimeout(0): StrictMode's doubled dev effect cleans
  // up before the timer fires, so each probe still fires once per open.
  // Cleanup clears every pending timer — nothing fires after unmount.
  const aiVisible = !firstRun || wizard.step === "ai";
  useEffect(() => {
    if (!aiVisible) return;
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const schedule = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };

    /** Loop one probe; it reports whether it got a definitive result. */
    const loop = (probe: () => Promise<boolean>) => {
      let definitive = false;
      const tick = () => {
        void probe().then((ok) => {
          if (cancelled) return;
          if (ok) definitive = true;
          schedule(tick, definitive ? SLOW_POLL_MS : FAST_POLL_MS);
        });
      };
      schedule(tick, 0);
    };

    // A rejected invoke = sidecar unreachable: keep "pending" before any
    // definitive result, flip to "unreachable" after one.
    const sidecarDown = <T,>(prev: ProbeState<T>): ProbeState<T> =>
      prev.kind === "pending" ? prev : { kind: "unreachable" };

    loop(async () => {
      try {
        const status = await invoke<ClaudeStatus>("claude_auth_status");
        if (!cancelled) setClaudeProbe({ kind: "done", value: status });
        return true;
      } catch {
        if (!cancelled) setClaudeProbe(sidecarDown);
        return false;
      }
    });
    loop(async () => {
      try {
        const probe = await invoke<OllamaProbe>("ollama_status");
        if (!cancelled) setOllamaState({ kind: "done", value: probe });
        return true;
      } catch {
        if (!cancelled) setOllamaState(sidecarDown);
        return false;
      }
    });

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
  }, [aiVisible]);

  // Settings only, ONCE per open: seed the checkbox from the LIVE plugin
  // state, not the stored config; until then it stays unchecked and
  // disabled. A failed probe leaves initialAutostart null (box disabled,
  // savePlan skips it) and surfaces on the error line. The wizard keeps its
  // default-checked box instead — nothing is registered yet on first run.
  // Unlike the provider probes this must NOT poll: re-seeding would clobber
  // a toggle the user already made, so the ref guard (re-renders and
  // StrictMode's doubled effect) stays.
  const autostartSeededRef = useRef(false);
  useEffect(() => {
    if (!aiVisible || firstRun || autostartSeededRef.current) return;
    autostartSeededRef.current = true;
    void invoke<boolean>("get_autostart")
      .then((enabled) => {
        setAutostart(enabled);
        setInitialAutostart(enabled);
      })
      .catch((err) => {
        console.error("get_autostart failed:", err);
        setError(`get_autostart failed: ${String(err)}`);
      });
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
      // Provider "none" saves with no model by design (AI off).
      if (plan.some((a) => a.cmd === "set_llm_config" && a.provider !== "none" && a.model === "")) {
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

  // Start button (T2): ask the sidecar to spawn `ollama serve`, then re-probe
  // on a fast local cadence (1.5s × 5) so the status line flips to "running"
  // well inside 10s — the main poll loop is already on its slow 15s cadence
  // by the time the button is visible, and this stays out of that loop's
  // machinery. Both loops only ever write the latest probe result, so
  // overlapping is harmless. A {started: false} result (binary missing) or
  // a rejected invoke renders inline under the status line — never silent.
  const startOllamaDaemon = async () => {
    setOllamaStarting(true);
    setOllamaStartError(null);
    try {
      const res = await invoke<OllamaStartResult>("ollama_start");
      if (!res.started) {
        setOllamaStartError(res.error ?? "failed to start ollama");
        return;
      }
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const probe = await invoke<OllamaProbe>("ollama_status");
          setOllamaState({ kind: "done", value: probe });
          if (probe.reachable) return;
        } catch {
          // Sidecar hiccup mid-retry: keep trying; the main poll loop still
          // owns the long-term state either way.
        }
      }
      setOllamaStartError("ollama was started but is not answering yet");
    } catch (err) {
      setOllamaStartError(`ollama_start failed: ${String(err)}`);
    } finally {
      setOllamaStarting(false);
    }
  };

  // "not authenticated" / "not running" render ONLY after a completed probe
  // that definitively said so. A sidecar that is down says exactly that —
  // it claims nothing about authentication or the ollama daemon.
  const claudeLine =
    claudeProbe.kind === "pending" ? (
      <span className="settings-note">checking…</span>
    ) : claudeProbe.kind === "unreachable" ? (
      <span className="field-parse field-parse-bad">sidecar unreachable</span>
    ) : claudeProbe.value.authenticated ? (
      <span className="field-parse">authenticated</span>
    ) : (
      <span className="field-parse field-parse-bad">
        not authenticated{claudeProbe.value.detail ? ` — ${claudeProbe.value.detail}` : ""}
      </span>
    );
  const ollamaLine =
    ollamaState.kind === "pending" ? (
      <span className="settings-note">checking…</span>
    ) : ollamaState.kind === "unreachable" ? (
      <span className="field-parse field-parse-bad">sidecar unreachable</span>
    ) : ollamaState.value.reachable ? (
      <span className="field-parse">
        running · {ollamaState.value.models.length} model
        {ollamaState.value.models.length === 1 ? "" : "s"}
      </span>
    ) : (
      <span className="field-parse field-parse-bad">not running</span>
    );
  // Start renders ONLY beside a definitive "not running" — never while
  // pending/unreachable (nothing to start yet / can't reach the sidecar)
  // and never while running. The inline start error follows the same guard,
  // so a stale error can't linger under a "running" line.
  const ollamaDown = ollamaState.kind === "done" && !ollamaState.value.reachable;

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
              {/* AI off. Always selectable — needs no daemon, no model. */}
              <option value="none">{PROVIDER_NONE_LABEL}</option>
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
              <span className="settings-note">
                {/* Presentation-only alignment (T4): the dropdown note and
                    the ollama status line must not disagree — a sidecar
                    that dropped out says so here too, not "checking…".
                    Provider "none" keeps its own note: off needs no sidecar. */}
                {llm.provider === "ollama" && ollamaState.kind === "unreachable"
                  ? "sidecar unreachable"
                  : listing.note}
              </span>
            )}
          </div>
          <div className="settings-status">
            <div>claude — {claudeLine}</div>
            {/* Auth guidance (T3): ONLY when a completed probe definitively
                said unauthenticated — never while pending or when the sidecar
                is unreachable. The polling loop above flips the probe to
                authenticated once the user signs in externally, and this
                block disappears without reopening the view. */}
            {claudeProbe.kind === "done" && !claudeProbe.value.authenticated && (
              <div className="settings-note">
                run <code>{SETUP_TOKEN_CMD}</code> in a terminal to sign in{" "}
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => void copySetupCommand()}
                  aria-label="copy claude setup-token command"
                >
                  copy command
                </button>
              </div>
            )}
            <div>
              ollama — {ollamaLine}
              {ollamaDown && (
                <button
                  type="button"
                  className="settings-btn settings-start-btn"
                  onClick={() => void startOllamaDaemon()}
                  disabled={ollamaStarting}
                >
                  {ollamaStarting ? "starting…" : "Start"}
                </button>
              )}
            </div>
            {ollamaDown && ollamaStartError !== null && (
              <div className="field-parse field-parse-bad">{ollamaStartError}</div>
            )}
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

      <div className="tasks-empty under-input settings-footer">{error ?? hint}</div>
    </div>
  );
}
