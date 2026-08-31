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
pub const LLM_PROVIDERS: [&str; 2] = ["claude", "ollama"];

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
}
