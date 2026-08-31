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
// NEVER run concurrently, so savePlan returns an ORDERED list (vault first)
// the caller awaits one action at a time, and the wizard yields exactly one
// action per step. Verified by scripts/settings-flow-demo.ts.

import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from "./llm-models";

export type SettingsMode = "wizard" | "settings";
export type WizardStep = "vault" | "ai";
export type ProviderId = "claude" | "ollama";
export type SettingsField = "vault" | "provider" | "model";

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
  if (mode === "wizard") return step === "vault" ? ["vault"] : ["provider", "model"];
  return ["vault", "provider", "model"];
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
  | { cmd: "set_llm_config"; provider: ProviderId; model: string };

function llmSaveAction(choice: LlmChoice): SaveAction {
  return { cmd: "set_llm_config", provider: choice.provider, model: selectedModel(choice) };
}

// Wizard: one action per Enter — the vault write completes (and the caller's
// vault re-resolution runs) before the AI step even renders, so the two
// config writes cannot interleave.

export interface WizardState {
  step: WizardStep;
  done: boolean;
}

export function initialWizard(): WizardState {
  return { step: "vault", done: false };
}

/** Enter on the current wizard step: the action to run, and the next state.
 *  vault → save the path, advance; ai → save the (pre)selected llm, done. */
export function wizardConfirm(
  state: WizardState,
  args: { vaultPath: string; llm: LlmChoice }
): { state: WizardState; action: SaveAction } {
  if (state.step === "vault") {
    return {
      state: { step: "ai", done: false },
      action: { cmd: "set_vault_dir", path: args.vaultPath },
    };
  }
  return { state: { step: "ai", done: true }, action: llmSaveAction(args.llm) };
}

/** Settings-mode Enter: only what changed, vault strictly first. The caller
 *  awaits each action before dispatching the next (the two commands must
 *  never run concurrently). `initialLlm` null (no saved llm yet) counts as
 *  changed, so the first save writes the defaults out. */
export function savePlan(args: {
  initialVaultPath: string;
  vaultPath: string;
  initialLlm: { provider: string; model: string } | null;
  llm: LlmChoice;
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
  return plan;
}
