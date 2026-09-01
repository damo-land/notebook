//! LLM provider/model configuration (T2), stored in
//! `~/.config/stash/config.json` under the `llm` key, alongside `vaultDir`:
//!
//! ```json
//! { "vaultDir": "...", "llm": { "provider": "claude", "model": "claude-haiku-4-5" } }
//! ```
//!
//! Reads are tolerant: a missing file, unparseable JSON, an absent `llm`
//! object, an unknown provider or a blank model all fall back to the defaults
//! (`claude` / `claude-haiku-4-5`) rather than erroring — the config file is
//! user-editable and a typo must not brick chat. Writes go through
//! [`update_config_json`], a read-modify-write over the whole file using the
//! same [`crate::atomic_write`] as `set_vault_dir`, so neither key can
//! clobber the other.
//!
//! Callers read the file FRESH per LLM call (never a launch-time copy), which
//! is what makes a settings change apply to the next chat/enrichment call
//! without a restart. Mirror of the TS side: sidecar/src/provider.ts
//! (`DEFAULT_LLM_CONFIG`, `coerceLlmConfig`) — keep the defaults in sync.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Providers the seam understands. Anything else in the file reads as claude.
/// "none" is the explicit off switch (UI label `--`): AI disabled, no LLM
/// call is ever dispatched — see [`llm_disabled`]. It is only ever chosen,
/// never a fallback: an unknown provider still reads as claude.
pub const LLM_PROVIDERS: [&str; 3] = ["claude", "ollama", "none"];

pub const DEFAULT_LLM_PROVIDER: &str = "claude";
pub const DEFAULT_CLAUDE_MODEL: &str = "claude-haiku-4-5";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmConfig {
    pub provider: String,
    pub model: String,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            provider: DEFAULT_LLM_PROVIDER.to_string(),
            model: DEFAULT_CLAUDE_MODEL.to_string(),
        }
    }
}

/// THE gating predicate for provider "none" (AI off): every LLM dispatch —
/// the enrichment worker, chat — checks this before calling the sidecar and
/// performs no LLM work when it is true. Skipped enrichment writes NO
/// `enriched:` marker: off must not mark notes as done.
pub fn llm_disabled(config: &LlmConfig) -> bool {
    config.provider == "none"
}

/// `~/.config/stash/config.json` — the one config file, shared with
/// `vaultDir` (see `resolve_vault_dir` in index.rs).
pub fn config_path(home: &Path) -> PathBuf {
    home.join(".config/stash/config.json")
}

/// The `llm` object out of a parsed config root, with per-field defaulting:
/// unknown provider -> claude; blank/missing model -> `claude-haiku-4-5`
/// under claude, empty under ollama (no meaningful default exists until the
/// daemon can be asked what is installed — T3).
pub fn llm_config_from_json(root: &serde_json::Value) -> LlmConfig {
    let llm = root.get("llm");
    let provider = llm
        .and_then(|v| v.get("provider"))
        .and_then(|v| v.as_str())
        .filter(|p| LLM_PROVIDERS.contains(p))
        .unwrap_or(DEFAULT_LLM_PROVIDER)
        .to_string();
    let model = llm
        .and_then(|v| v.get("model"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            if provider == DEFAULT_LLM_PROVIDER {
                DEFAULT_CLAUDE_MODEL.to_string()
            } else {
                String::new()
            }
        });
    LlmConfig { provider, model }
}

/// The current LLM config from disk. Absent/unreadable/unparseable file ->
/// defaults, never an error.
pub fn read_llm_config(home: &Path) -> LlmConfig {
    let root = std::fs::read_to_string(config_path(home))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .unwrap_or(serde_json::Value::Null);
    llm_config_from_json(&root)
}

/// [`read_llm_config`] for code with no `AppHandle` — the enrichment worker
/// thread reads the config per job through `$HOME`. Unset/blank HOME ->
/// defaults.
pub fn read_llm_config_env_home() -> LlmConfig {
    match std::env::var("HOME") {
        Ok(home) if !home.trim().is_empty() => read_llm_config(Path::new(&home)),
        _ => LlmConfig::default(),
    }
}

/// Read-modify-write of `~/.config/stash/config.json`: parses the current
/// file (an absent or unparseable one starts from `{}`), lets `update` mutate
/// the root object, and persists via [`crate::atomic_write`] — the same
/// mechanism as every other durable write, so a crash can never leave the one
/// file that locates the vault half-written. Both writers (`set_vault_dir`
/// and `set_llm_config`) go through here, so each preserves the other's key.
pub fn update_config_json(
    home: &Path,
    update: impl FnOnce(&mut serde_json::Map<String, serde_json::Value>),
) -> Result<(), String> {
    let path = config_path(home);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    let mut root = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    update(&mut root);
    crate::atomic_write(
        &path,
        serde_json::Value::Object(root).to_string().as_bytes(),
        None,
    )
    .map_err(|e| format!("write {}: {e}", path.display()))
}

// ---------------------------------------------------------------------------
// First-run provider auto-detect (T3): claude > ollama > none.
//
// Runs once, silently, at app setup — ONLY when the config has no `llm` key
// at all. Whatever it picks is persisted, so it never runs again and never
// overwrites a user's choice (including an explicit "none"). Every probe
// failure is silent by construction: the probes return bool, nothing here
// errors, logs at error level, or touches the UI.
// ---------------------------------------------------------------------------

/// True when the config file already carries an `llm` key (any value):
/// detection must then not run at all.
fn config_has_llm_key(home: &Path) -> bool {
    std::fs::read_to_string(config_path(home))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .map(|root| root.get("llm").is_some())
        .unwrap_or(false)
}

/// Claude Code credentials present on this machine?
///
/// Chosen signal: `~/.claude/.credentials.json` exists (where Claude Code
/// stores OAuth credentials when not using the keychain), OR the macOS
/// Keychain holds a "Claude Code-credentials" generic password (the default
/// storage on macOS) — checked via `security find-generic-password`, exit
/// status only, output discarded. Either hit means `claude setup-token` /
/// login has happened here, which is exactly what the sidecar's claude
/// provider needs.
fn claude_credentials_present() -> bool {
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty()
            && Path::new(&home).join(".claude/.credentials.json").exists()
        {
            return true;
        }
    }
    std::process::Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Ollama responding on localhost:11434?
///
/// Plain TCP connect with a 1s timeout — src-tauri deliberately has no HTTP
/// client dependency, and a listener on Ollama's well-known port is in
/// practice Ollama. Tradeoff: any other process squatting on 11434 would
/// read as Ollama; acceptable for a one-time silent default that the user
/// can change in settings.
fn ollama_reachable() -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], 11434));
    std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(1000)).is_ok()
}

/// The detection core, probes injected so tests can mock them. Returns the
/// persisted choice, or `None` when the config already has an `llm` key
/// (no-op — the probes are not even called). Order: claude credentials ->
/// claude (default model), else ollama reachable -> ollama (empty model,
/// the existing ollama defaulting), else none. A failed write is swallowed:
/// worst case detection just runs again next launch.
pub fn detect_and_persist_provider(
    home: &Path,
    claude_creds: impl FnOnce() -> bool,
    ollama_up: impl FnOnce() -> bool,
) -> Option<LlmConfig> {
    if config_has_llm_key(home) {
        return None;
    }
    let chosen = if claude_creds() {
        LlmConfig::default() // claude / claude-haiku-4-5
    } else if ollama_up() {
        LlmConfig {
            provider: "ollama".to_string(),
            model: String::new(),
        }
    } else {
        LlmConfig {
            provider: "none".to_string(),
            model: String::new(),
        }
    };
    let _ = update_config_json(home, |root| {
        root.insert(
            "llm".into(),
            serde_json::json!({ "provider": chosen.provider, "model": chosen.model }),
        );
    });
    Some(chosen)
}

/// [`detect_and_persist_provider`] with the real probes — the one entry
/// point app setup calls (lib.rs), before anything reads the llm config.
/// Bounded: file stat + at most one `security` exec + a 1s-capped TCP
/// connect, and skipped entirely on every launch after the first.
pub fn detect_provider_on_first_run(home: &Path) {
    detect_and_persist_provider(home, claude_credentials_present, ollama_reachable);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "stash-llm-config-test-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_config(home: &Path, raw: &str) {
        std::fs::create_dir_all(home.join(".config/stash")).unwrap();
        std::fs::write(config_path(home), raw).unwrap();
    }

    /// Absent file, config without `llm`, and unparseable JSON all read as
    /// the documented default: claude / claude-haiku-4-5.
    #[test]
    fn missing_or_bad_config_defaults_to_claude_haiku() {
        let home = scratch_home("defaults");
        let default = LlmConfig {
            provider: "claude".into(),
            model: "claude-haiku-4-5".into(),
        };
        assert_eq!(read_llm_config(&home), default); // no file at all

        write_config(&home, r#"{"vaultDir": "~/Stash"}"#);
        assert_eq!(read_llm_config(&home), default); // no llm key

        write_config(&home, "{not json");
        assert_eq!(read_llm_config(&home), default); // unparseable

        let _ = std::fs::remove_dir_all(&home);
    }

    /// A well-formed `llm` object is read as-is, for both providers.
    #[test]
    fn configured_llm_object_is_read() {
        let home = scratch_home("configured");
        write_config(
            &home,
            r#"{"vaultDir": "~/Stash", "llm": {"provider": "ollama", "model": "llama3.2:3b"}}"#,
        );
        assert_eq!(
            read_llm_config(&home),
            LlmConfig {
                provider: "ollama".into(),
                model: "llama3.2:3b".into()
            }
        );

        write_config(
            &home,
            r#"{"llm": {"provider": "claude", "model": "claude-opus-5"}}"#,
        );
        assert_eq!(
            read_llm_config(&home),
            LlmConfig {
                provider: "claude".into(),
                model: "claude-opus-5".into()
            }
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Provider "none" (AI off, UI label `--`) is a KNOWN provider: it reads
    /// back as none (empty model), persists through the merge-writer, and
    /// gates every LLM call via llm_disabled. An unknown provider still
    /// falls back to the claude default — off is an explicit choice, never
    /// a typo's meaning.
    #[test]
    fn provider_none_is_accepted_persisted_and_gates() {
        assert!(LLM_PROVIDERS.contains(&"none"));

        let none = serde_json::json!({"llm": {"provider": "none"}});
        let cfg = llm_config_from_json(&none);
        assert_eq!(cfg.provider, "none");
        assert_eq!(cfg.model, "");
        assert!(llm_disabled(&cfg));
        assert!(!llm_disabled(&LlmConfig::default()));
        assert!(!llm_disabled(&LlmConfig {
            provider: "ollama".into(),
            model: "llama3.2:3b".into()
        }));

        // Unknown provider: still the claude default, NOT none.
        let unknown = serde_json::json!({"llm": {"provider": "gpt"}});
        assert_eq!(llm_config_from_json(&unknown).provider, "claude");

        // Persisted round trip through the same merge-writer as settings.
        let home = scratch_home("none");
        update_config_json(&home, |root| {
            root.insert("llm".into(), serde_json::json!({"provider": "none"}));
        })
        .unwrap();
        let read = read_llm_config(&home);
        assert_eq!(read.provider, "none");
        assert!(llm_disabled(&read));
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Per-field defaulting: unknown provider -> claude; blank model ->
    /// claude default under claude, empty under ollama.
    #[test]
    fn partial_llm_objects_default_per_field() {
        let unknown_provider = serde_json::json!({"llm": {"provider": "gpt", "model": "claude-sonnet-5"}});
        assert_eq!(
            llm_config_from_json(&unknown_provider),
            LlmConfig {
                provider: "claude".into(),
                model: "claude-sonnet-5".into()
            }
        );

        let blank_model = serde_json::json!({"llm": {"provider": "claude", "model": "  "}});
        assert_eq!(llm_config_from_json(&blank_model), LlmConfig::default());

        let ollama_no_model = serde_json::json!({"llm": {"provider": "ollama"}});
        assert_eq!(
            llm_config_from_json(&ollama_no_model),
            LlmConfig {
                provider: "ollama".into(),
                model: String::new()
            }
        );
    }

    /// The two writers can't clobber each other: setting `llm` preserves
    /// `vaultDir` and vice versa, and the write creates the config dir when
    /// it doesn't exist yet.
    #[test]
    fn update_config_json_preserves_unrelated_keys() {
        let home = scratch_home("merge");

        // First write into a home with no .config/stash at all.
        update_config_json(&home, |root| {
            root.insert("vaultDir".into(), serde_json::json!("~/Vaults/work"));
        })
        .unwrap();
        update_config_json(&home, |root| {
            root.insert(
                "llm".into(),
                serde_json::json!({"provider": "ollama", "model": "llama3.2:3b"}),
            );
        })
        .unwrap();
        // Re-pointing the vault must not drop the llm choice…
        update_config_json(&home, |root| {
            root.insert("vaultDir".into(), serde_json::json!("~/Vaults/personal"));
        })
        .unwrap();

        let raw = std::fs::read_to_string(config_path(&home)).unwrap();
        let root: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(root["vaultDir"], "~/Vaults/personal");
        assert_eq!(root["llm"]["provider"], "ollama");
        assert_eq!(root["llm"]["model"], "llama3.2:3b");
        // …and the round trip through read_llm_config agrees.
        assert_eq!(
            read_llm_config(&home),
            LlmConfig {
                provider: "ollama".into(),
                model: "llama3.2:3b".into()
            }
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// The `autostart` key (T1's set_autostart) round-trips through the same
    /// merge-writer without clobbering `vaultDir`/`llm` — and writing those
    /// afterwards preserves `autostart` right back.
    #[test]
    fn update_config_json_autostart_round_trips_without_clobbering() {
        let home = scratch_home("autostart");

        write_config(
            &home,
            r#"{"vaultDir": "~/Vaults/work", "llm": {"provider": "ollama", "model": "llama3.2:3b"}}"#,
        );
        // autostart on, then off: both writes must leave the other keys alone.
        for enabled in [true, false] {
            update_config_json(&home, |root| {
                root.insert("autostart".into(), serde_json::Value::Bool(enabled));
            })
            .unwrap();
            let raw = std::fs::read_to_string(config_path(&home)).unwrap();
            let root: serde_json::Value = serde_json::from_str(&raw).unwrap();
            assert_eq!(root["autostart"], enabled);
            assert_eq!(root["vaultDir"], "~/Vaults/work");
            assert_eq!(root["llm"]["provider"], "ollama");
            assert_eq!(root["llm"]["model"], "llama3.2:3b");
        }

        // …and the other direction: re-pointing the vault / switching the LLM
        // must not drop the persisted autostart choice.
        update_config_json(&home, |root| {
            root.insert("vaultDir".into(), serde_json::json!("~/Vaults/personal"));
        })
        .unwrap();
        update_config_json(&home, |root| {
            root.insert(
                "llm".into(),
                serde_json::json!({"provider": "claude", "model": "claude-haiku-4-5"}),
            );
        })
        .unwrap();
        let raw = std::fs::read_to_string(config_path(&home)).unwrap();
        let root: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(root["autostart"], false);
        assert_eq!(root["vaultDir"], "~/Vaults/personal");
        assert_eq!(root["llm"]["provider"], "claude");

        let _ = std::fs::remove_dir_all(&home);
    }

    /// First-run auto-detect, all three outcomes (probes mocked as closures):
    /// claude credentials win over ollama, ollama wins over none, and the
    /// chosen provider is persisted with its default model (claude ->
    /// claude-haiku-4-5, ollama/none -> empty, matching the existing
    /// per-provider defaulting).
    #[test]
    fn detect_persists_claude_over_ollama_over_none() {
        // claude creds present -> claude, even with ollama also up.
        let home = scratch_home("detect-claude");
        let chosen = detect_and_persist_provider(&home, || true, || true);
        assert_eq!(
            chosen,
            Some(LlmConfig {
                provider: "claude".into(),
                model: DEFAULT_CLAUDE_MODEL.into()
            })
        );
        assert_eq!(read_llm_config(&home), chosen.unwrap());
        let _ = std::fs::remove_dir_all(&home);

        // no claude creds, ollama reachable -> ollama, empty model.
        let home = scratch_home("detect-ollama");
        let chosen = detect_and_persist_provider(&home, || false, || true);
        assert_eq!(
            chosen,
            Some(LlmConfig {
                provider: "ollama".into(),
                model: String::new()
            })
        );
        assert_eq!(read_llm_config(&home), chosen.unwrap());
        let _ = std::fs::remove_dir_all(&home);

        // neither -> none, persisted (so detection never runs again), and the
        // resulting config gates LLM calls without any error.
        let home = scratch_home("detect-none");
        let chosen = detect_and_persist_provider(&home, || false, || false);
        assert_eq!(
            chosen,
            Some(LlmConfig {
                provider: "none".into(),
                model: String::new()
            })
        );
        let raw = std::fs::read_to_string(config_path(&home)).unwrap();
        let root: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(root["llm"]["provider"], "none");
        assert!(llm_disabled(&read_llm_config(&home)));
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Detection is a no-op whenever the config already has an `llm` key —
    /// including `provider: "none"`: a persisted explicit off must never be
    /// flipped back on by a probe. The probes must not even run (they panic
    /// here), and the file bytes stay untouched.
    #[test]
    fn detect_is_noop_when_llm_key_exists() {
        for persisted in [
            r#"{"vaultDir": "~/Stash", "llm": {"provider": "none"}}"#,
            r#"{"llm": {"provider": "ollama", "model": "llama3.2:3b"}}"#,
        ] {
            let home = scratch_home("detect-noop");
            write_config(&home, persisted);
            let chosen = detect_and_persist_provider(
                &home,
                || panic!("claude probe must not run when llm key exists"),
                || panic!("ollama probe must not run when llm key exists"),
            );
            assert_eq!(chosen, None);
            assert_eq!(
                std::fs::read_to_string(config_path(&home)).unwrap(),
                persisted,
                "existing config must not be rewritten"
            );
            let _ = std::fs::remove_dir_all(&home);
        }
    }

    /// NOT a live smoke. `app.autolaunch()` needs a real `AppHandle` — the
    /// plugin's manager is built from the running app's bundle identity, and
    /// tauri's mock runtime sits behind the unapproved `test` feature — so
    /// login-item registration (machine state anyway, not CI material) can
    /// only be exercised in the running app:
    ///
    ///   1. `npm run tauri dev`
    ///   2. invoke `set_autostart` with `enabled: true` from the webview
    ///      console: `window.__TAURI__` or the settings UI once T2 lands
    ///   3. check `~/Library/LaunchAgents/` for the app's plist and
    ///      `get_autostart` -> true; then disable and re-check both.
    ///
    /// Kept `#[ignore]`d so `cargo test -- --ignored` surfaces this note
    /// instead of silently passing nothing.
    #[test]
    #[ignore = "live autolaunch smoke needs a running app handle; see doc comment for the manual steps"]
    fn autostart_smoke() {
        eprintln!(
            "autostart_smoke: no live plugin call here — run the app and flip \
             set_autostart manually (see this test's doc comment)."
        );
    }
}
