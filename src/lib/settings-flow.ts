// Settings/wizard flow rules (T5): the DOM-free logic behind the setup view —
// which step the first-run wizard is on, which field Tab/arrows land on next,
// which model list a provider shows, and exactly what a confirm saves.
//
// Two modes, one component (src/components/setup-view.tsx):
//   "wizard"   — first run: vault step (unchanged T6 behaviour) then AI step,
//                preselected claude / DEFAULT_CLAUDE_MODEL so Enter, Enter on
//                a fresh machine saves the defaults and lands in capture. Esc
//                is swallowed: there is nothing to fall back to.
//   "settings" — tray → Settings…: both sections visible at once; Enter saves
//                only what changed, Esc closes back to capture.
//
// Save sequencing is encoded here, not left to the component: set_vault_dir
// and set_llm_config both read-modify-write the same config.json and must
// NEVER run concurrently (set_autostart also merges into config.json), so
// savePlan returns an ORDERED list (vault first, autostart last) the caller
// awaits one action at a time, and the wizard yields an ordered list per
// step, run the same way. Verified by scripts/settings-flow-demo.ts.

import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from "./llm-models";

export type SettingsMode = "wizard" | "settings";
export type WizardStep = "vault" | "ai";
export type ProviderId = "claude" | "ollama";
export type SettingsField = "vault" | "provider" | "model" | "autostart";

/** The wizard's "Launch at login" checkbox starts CHECKED: the pure
 *  Enter-Enter path on a fresh machine enables autostart. */
export const WIZARD_AUTOSTART_DEFAULT = true;

/** `ollama_status` command result; null while the probe is still in flight. */
export interface OllamaProbe {
  reachable: boolean;
  models: string[];
}

/** Ollama status lines the view renders verbatim. */
export const OLLAMA_DOWN = "Ollama not running";
export const OLLAMA_PULL_HINT = "no models pulled — run: ollama pull qwen3:8b";
export const OLLAMA_CHECKING = "checking…";

// --- the llm choice: one model remembered PER provider -----------------------
//
// Toggling claude → ollama → claude must not lose the claude pick, so the
// choice holds both slots and `provider` says which one is live.

export interface LlmChoice {
  provider: ProviderId;
  claudeModel: string;
  /** Empty until picked — there is no default ollama model to assume. */
  ollamaModel: string;
}

/** Seed a choice from the saved config (get_llm_config), or from nothing:
 *  claude / DEFAULT_CLAUDE_MODEL, the wizard's preselection. */
export function initialLlmChoice(saved?: { provider: string; model: string } | null): LlmChoice {
  const choice: LlmChoice = {
    provider: "claude",
    claudeModel: DEFAULT_CLAUDE_MODEL,
    ollamaModel: "",
  };
  if (!saved) return choice;
  if (saved.provider === "ollama") {
    return { ...choice, provider: "ollama", ollamaModel: saved.model };
  }
  return { ...choice, claudeModel: saved.model || DEFAULT_CLAUDE_MODEL };
}

/** The live provider's model — what a save would write. */
export function selectedModel(choice: LlmChoice): string {
  return choice.provider === "ollama" ? choice.ollamaModel : choice.claudeModel;
}

export function withProvider(choice: LlmChoice, provider: ProviderId): LlmChoice {
  return { ...choice, provider };
}

/** Set the LIVE provider's model; the other provider's slot is untouched. */
export function withModel(choice: LlmChoice, model: string): LlmChoice {
  return choice.provider === "ollama"
    ? { ...choice, ollamaModel: model }
    : { ...choice, claudeModel: model };
}

/** Ollama with no model picked has nothing coherent to save. */
export function canSaveLlm(choice: LlmChoice): boolean {
  return selectedModel(choice) !== "";
}

// --- model list per provider --------------------------------------------------

export interface ModelListing {
  /** Dropdown entries; empty means the dropdown is replaced by `note`. */
  options: readonly string[];
  /** Status/hint line when there is nothing to pick. */
  note: string | null;
}

/** Which models a provider offers: claude → the curated list; ollama → the
 *  live probe result (down → OLLAMA_DOWN, up-but-empty → the pull hint). */
export function modelListing(provider: ProviderId, probe: OllamaProbe | null): ModelListing {
  if (provider === "claude") return { options: CLAUDE_MODELS, note: null };
  if (probe === null) return { options: [], note: OLLAMA_CHECKING };
  if (!probe.reachable) return { options: [], note: OLLAMA_DOWN };
  if (probe.models.length === 0) return { options: [], note: OLLAMA_PULL_HINT };
  return { options: probe.models, note: null };
}

/** The ollama option stays visible but disabled until the probe says the
 *  daemon is up; claude is always selectable (auth is a status line, not a
 *  gate — an unauthenticated pick just fails at chat time with its message). */
export function providerSelectable(provider: ProviderId, probe: OllamaProbe | null): boolean {
  return provider === "claude" || probe?.reachable === true;
}

// --- field order: what Tab / arrows cycle through -----------------------------

/** Focusable fields, in visual order. The wizard shows one step at a time;
 *  settings shows every section at once. */
export function fieldOrder(mode: SettingsMode, step: WizardStep): SettingsField[] {
  if (mode === "wizard") return step === "vault" ? ["vault"] : ["provider", "model", "autostart"];
  return ["vault", "provider", "model", "autostart"];
}

/** Next field in `order` from `current`, wrapping; unknown current → first. */
export function nextField(order: SettingsField[], current: SettingsField, delta: 1 | -1): SettingsField {
  const at = order.indexOf(current);
  if (at === -1) return order[0];
  return order[(at + delta + order.length) % order.length];
}

// --- Esc rule ------------------------------------------------------------------

/** Esc closes the settings view; on first run it is swallowed (there is no
 *  configured vault to fall back to, so the wizard stays up). */
export function escCloses(mode: SettingsMode): boolean {
  return mode === "settings";
}

// --- what a confirm saves ------------------------------------------------------

export type SaveAction =
  | { cmd: "set_vault_dir"; path: string }
  | { cmd: "set_llm_config"; provider: ProviderId; model: string }
  | { cmd: "set_autostart"; enabled: boolean };

function llmSaveAction(choice: LlmChoice): SaveAction {
  return { cmd: "set_llm_config", provider: choice.provider, model: selectedModel(choice) };
}

// Wizard: an ORDERED action list per Enter, run one at a time — the vault
// write completes (and the caller's vault re-resolution runs) before the AI
// step even renders, and the AI step's llm write completes before the
// autostart write starts, so no two config writers ever interleave.

export interface WizardState {
  step: WizardStep;
  done: boolean;
}

export function initialWizard(): WizardState {
  return { step: "vault", done: false };
}

/** Enter on the current wizard step: the ORDERED actions to run (the caller
 *  awaits each before the next), and the next state. vault → save the path,
 *  advance; ai → save the (pre)selected llm, then ALWAYS set_autostart with
 *  the checkbox state (checked default → true; unchecked → false — an
 *  explicit disable, idempotent on a fresh machine), done. Pure: a failed
 *  action leaves the caller on the same state, and re-confirming it yields
 *  the IDENTICAL plan — the retry after a set_autostart refusal re-runs the
 *  idempotent llm write, then set_autostart again, with nothing duplicated
 *  beyond that. */
export function wizardConfirm(
  state: WizardState,
  args: { vaultPath: string; llm: LlmChoice; autostart: boolean }
): { state: WizardState; actions: SaveAction[] } {
  if (state.step === "vault") {
    return {
      state: { step: "ai", done: false },
      actions: [{ cmd: "set_vault_dir", path: args.vaultPath }],
    };
  }
  return {
    state: { step: "ai", done: true },
    actions: [llmSaveAction(args.llm), { cmd: "set_autostart", enabled: args.autostart }],
  };
}

/** Settings-mode Enter: only what changed, vault strictly first, autostart
 *  strictly last. The caller awaits each action before dispatching the next
 *  (the config-writing commands must never run concurrently). `initialLlm`
 *  null (no saved llm yet) counts as changed, so the first save writes the
 *  defaults out; `initialAutostart` null (get_autostart probe unresolved or
 *  FAILED) is the opposite — NO change, never a set_autostart: the view
 *  disables the checkbox until the probe seeds it, so an untouched box (or a
 *  fast Enter, or a failed probe) can never silently flip autostart. */
export function savePlan(args: {
  initialVaultPath: string;
  vaultPath: string;
  initialLlm: { provider: string; model: string } | null;
  llm: LlmChoice;
  initialAutostart: boolean | null;
  autostart: boolean;
}): SaveAction[] {
  const plan: SaveAction[] = [];
  if (args.vaultPath.trim() !== args.initialVaultPath.trim()) {
    plan.push({ cmd: "set_vault_dir", path: args.vaultPath });
  }
  const llmChanged =
    args.initialLlm === null ||
    args.initialLlm.provider !== args.llm.provider ||
    args.initialLlm.model !== selectedModel(args.llm);
  if (llmChanged) plan.push(llmSaveAction(args.llm));
  if (args.initialAutostart !== null && args.initialAutostart !== args.autostart) {
    plan.push({ cmd: "set_autostart", enabled: args.autostart });
  }
  return plan;
}
