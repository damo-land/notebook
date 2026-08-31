// Demo/verification for the T5 settings/wizard flow rules. Run:
//   npx tsx scripts/settings-flow-demo.ts
//
// Proves the pure module (src/lib/settings-flow.ts) behind the setup wizard
// and the tray settings view: the two-step wizard lands on defaults with a
// double Enter (including set_autostart(true) from the default-checked
// "Launch at login" box), the provider toggle switches the model-list source,
// the save plan holds only what changed (vault first, autostart last), and
// Esc is swallowed on first run but closes the settings view otherwise.

import assert from "node:assert";
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from "../src/lib/llm-models";
import {
  OLLAMA_DOWN,
  OLLAMA_PULL_HINT,
  WIZARD_AUTOSTART_DEFAULT,
  canSaveLlm,
  escCloses,
  fieldOrder,
  initialLlmChoice,
  initialWizard,
  modelListing,
  nextField,
  providerSelectable,
  savePlan,
  selectedModel,
  withModel,
  withProvider,
  wizardConfirm,
} from "../src/lib/settings-flow";

// --- two-step wizard: Enter, Enter on a fresh machine lands on defaults ------

{
  let w = initialWizard();
  assert.strictEqual(w.step, "vault");
  assert.strictEqual(w.done, false);

  // First Enter: the vault step saves the (suggested) path and advances.
  const llm = initialLlmChoice(null); // fresh machine: no saved llm config
  const first = wizardConfirm(w, {
    vaultPath: "/Users/me/Stash",
    llm,
    autostart: WIZARD_AUTOSTART_DEFAULT,
  });
  assert.deepStrictEqual(first.actions, [{ cmd: "set_vault_dir", path: "/Users/me/Stash" }]);
  assert.strictEqual(first.state.step, "ai");
  assert.strictEqual(first.state.done, false);

  // Second Enter: the AI step is preselected claude / default model with the
  // "Launch at login" checkbox CHECKED by default, so the untouched confirm
  // saves exactly those defaults — llm first, then set_autostart(true) — and
  // finishes the wizard. Design decision: the wizard ALWAYS calls
  // set_autostart with the checkbox state on completion.
  assert.strictEqual(WIZARD_AUTOSTART_DEFAULT, true);
  const second = wizardConfirm(first.state, {
    vaultPath: "/Users/me/Stash",
    llm,
    autostart: WIZARD_AUTOSTART_DEFAULT,
  });
  assert.deepStrictEqual(second.actions, [
    { cmd: "set_llm_config", provider: "claude", model: DEFAULT_CLAUDE_MODEL },
    { cmd: "set_autostart", enabled: true },
  ]);
  assert.strictEqual(second.state.done, true);

  // Unchecking the box before confirming: the same ordered save, but the
  // wizard explicitly calls set_autostart(false) — no enablement happens.
  const unchecked = wizardConfirm(first.state, {
    vaultPath: "/Users/me/Stash",
    llm,
    autostart: false,
  });
  assert.deepStrictEqual(unchecked.actions[1], { cmd: "set_autostart", enabled: false });
  assert.strictEqual(unchecked.state.done, true);

  // Partial-failure retry (audit fix 2): if set_autostart rejects after
  // set_llm_config already succeeded, the view keeps the SAME ai-step state
  // (setWizard never ran) and shows the error; the next Enter re-confirms
  // that state. wizardConfirm is pure, so the retry plan is IDENTICAL —
  // re-running the idempotent llm write, then set_autostart again — and no
  // extra actions accumulate across retries.
  const retry = wizardConfirm(first.state, {
    vaultPath: "/Users/me/Stash",
    llm,
    autostart: WIZARD_AUTOSTART_DEFAULT,
  });
  assert.deepStrictEqual(retry.actions, second.actions); // stable retry plan
  assert.deepStrictEqual(retry.state, second.state);
}

// --- provider toggle switches the model-list source --------------------------

{
  // Claude: the curated list, regardless of any probe.
  const claude = modelListing("claude", null);
  assert.deepStrictEqual([...claude.options], [...CLAUDE_MODELS]);
  assert.strictEqual(claude.note, null);

  // Ollama: the live probe result is the list.
  const up = { reachable: true, models: ["qwen3:8b", "llama3.2:3b"] };
  const ollama = modelListing("ollama", up);
  assert.deepStrictEqual([...ollama.options], up.models);
  assert.strictEqual(ollama.note, null);

  // Reachable but nothing pulled: no options, the pull hint instead.
  const empty = modelListing("ollama", { reachable: true, models: [] });
  assert.deepStrictEqual([...empty.options], []);
  assert.strictEqual(empty.note, OLLAMA_PULL_HINT);

  // Daemon down: no options, "Ollama not running", option not selectable.
  const down = modelListing("ollama", { reachable: false, models: [] });
  assert.deepStrictEqual([...down.options], []);
  assert.strictEqual(down.note, OLLAMA_DOWN);
  assert.strictEqual(providerSelectable("ollama", { reachable: false, models: [] }), false);

  // Probe still in flight (null): not selectable yet, no false "not running".
  assert.strictEqual(providerSelectable("ollama", null), false);
  assert.strictEqual(modelListing("ollama", null).note, "checking…");

  // Claude is always selectable — its status line reports auth separately.
  assert.strictEqual(providerSelectable("claude", null), true);
}

// --- per-provider model memory: toggling back keeps the earlier pick ---------

{
  let c = initialLlmChoice({ provider: "claude", model: "claude-sonnet-5" });
  assert.strictEqual(selectedModel(c), "claude-sonnet-5");

  c = withProvider(c, "ollama"); // switch source; nothing picked there yet
  assert.strictEqual(selectedModel(c), "");
  assert.strictEqual(canSaveLlm(c), false); // no model -> nothing to save

  c = withModel(c, "qwen3:8b");
  assert.strictEqual(selectedModel(c), "qwen3:8b");
  assert.strictEqual(canSaveLlm(c), true);

  c = withProvider(c, "claude"); // back: the claude pick survived the toggle
  assert.strictEqual(selectedModel(c), "claude-sonnet-5");

  // A saved ollama config loads into the ollama slot, claude keeps its default.
  const o = initialLlmChoice({ provider: "ollama", model: "llama3.2:3b" });
  assert.strictEqual(o.provider, "ollama");
  assert.strictEqual(selectedModel(o), "llama3.2:3b");
  assert.strictEqual(selectedModel(withProvider(o, "claude")), DEFAULT_CLAUDE_MODEL);
}

// --- settings save plan: only what changed, vault strictly before llm --------

{
  const initial = {
    initialVaultPath: "/v/old",
    initialLlm: { provider: "claude", model: DEFAULT_CLAUDE_MODEL },
    // Settings mode seeds the checkbox from get_autostart (live plugin
    // state); false here stands in for "not currently enabled".
    initialAutostart: false,
  };
  const llmUnchanged = initialLlmChoice(initial.initialLlm);

  // Nothing changed: nothing to save (Enter just closes) — an untouched
  // autostart checkbox in particular does NOT re-call set_autostart.
  // Design decision: settings mode saves autostart only when it changed.
  assert.deepStrictEqual(
    savePlan({ ...initial, vaultPath: "/v/old", llm: llmUnchanged, autostart: false }),
    []
  );

  // Vault only.
  assert.deepStrictEqual(
    savePlan({ ...initial, vaultPath: "/v/new", llm: llmUnchanged, autostart: false }),
    [{ cmd: "set_vault_dir", path: "/v/new" }]
  );

  // LLM only (model change).
  const llmChanged = withModel(llmUnchanged, "claude-opus-5");
  assert.deepStrictEqual(
    savePlan({ ...initial, vaultPath: "/v/old", llm: llmChanged, autostart: false }),
    [{ cmd: "set_llm_config", provider: "claude", model: "claude-opus-5" }]
  );

  // Autostart only: toggling the checkbox saves exactly one set_autostart
  // with the new state — in both directions.
  assert.deepStrictEqual(
    savePlan({ ...initial, vaultPath: "/v/old", llm: llmUnchanged, autostart: true }),
    [{ cmd: "set_autostart", enabled: true }]
  );
  assert.deepStrictEqual(
    savePlan({ ...initial, initialAutostart: true, vaultPath: "/v/old", llm: llmUnchanged, autostart: false }),
    [{ cmd: "set_autostart", enabled: false }]
  );

  // Everything changed: vault first, llm second, autostart last — the caller
  // awaits each action in order, so no two config writers run concurrently.
  assert.deepStrictEqual(
    savePlan({ ...initial, vaultPath: "/v/new", llm: llmChanged, autostart: true }),
    [
      { cmd: "set_vault_dir", path: "/v/new" },
      { cmd: "set_llm_config", provider: "claude", model: "claude-opus-5" },
      { cmd: "set_autostart", enabled: true },
    ]
  );

  // No saved llm yet (fresh config): a default-valued choice still saves once.
  // But a null initialAutostart — the get_autostart probe unresolved or
  // failed — is "no change" (audit fix 1): the checkbox is disabled until the
  // probe seeds it, and an untouched box must NEVER emit a set_autostart, so
  // a fast Enter or a failed probe cannot silently flip autostart.
  assert.deepStrictEqual(
    savePlan({
      initialVaultPath: "/v/old",
      initialLlm: null,
      initialAutostart: null,
      vaultPath: "/v/old",
      llm: llmUnchanged,
      autostart: false,
    }),
    [{ cmd: "set_llm_config", provider: "claude", model: DEFAULT_CLAUDE_MODEL }]
  );

  // Same with everything else unchanged: null initial → EMPTY plan, no
  // set_autostart regardless of what the (disabled) checkbox state holds.
  assert.deepStrictEqual(
    savePlan({ ...initial, initialAutostart: null, vaultPath: "/v/old", llm: llmUnchanged, autostart: false }),
    []
  );
  assert.deepStrictEqual(
    savePlan({ ...initial, initialAutostart: null, vaultPath: "/v/old", llm: llmUnchanged, autostart: true }),
    []
  );
}

// --- Esc rules: swallowed on first run, closes the settings view otherwise ---

assert.strictEqual(escCloses("wizard"), false);
assert.strictEqual(escCloses("settings"), true);

// --- field order + Tab/arrow cycling -----------------------------------------

{
  assert.deepStrictEqual(fieldOrder("wizard", "vault"), ["vault"]);
  assert.deepStrictEqual(fieldOrder("wizard", "ai"), ["provider", "model", "autostart"]);
  assert.deepStrictEqual(fieldOrder("settings", "ai"), ["vault", "provider", "model", "autostart"]);

  const order = fieldOrder("settings", "ai");
  assert.strictEqual(nextField(order, "vault", 1), "provider");
  assert.strictEqual(nextField(order, "model", 1), "autostart"); // checkbox reachable
  assert.strictEqual(nextField(order, "autostart", 1), "vault"); // wraps forward
  assert.strictEqual(nextField(order, "vault", -1), "autostart"); // wraps back
  assert.strictEqual(nextField(order, "nope" as never, 1), "vault"); // unknown -> first
}

console.log("settings-flow demo: all assertions passed");
