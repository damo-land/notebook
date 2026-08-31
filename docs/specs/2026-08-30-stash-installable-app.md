# Stash: installable app + iteration-2 UX

Status: done
Source: v1 works but is dev-mode-only on one machine — no installer, vault path
hidden in a config file, overlay misses Spaces, chat drops you mid-answer, no
delete, no browse-all. This iteration makes it an installable, daily-drivable
app named **stash**.

## Goal

`brew install --cask damo/tap/stash` on a fresh Mac → signed+notarized app
opens with zero Gatekeeper warnings → first-run wizard detects Obsidian and
offers `<obsidian-vault>/stash/` as the vault (fallback `~/Stash`) → overlay
follows the active Space, chat answers stay readable, notes are deletable
(⌘⌫ → macOS Trash), empty search lists everything, and the app degrades
gracefully when no Claude auth is present.

## Non-goals

- Ollama / alternative LLM providers (next iteration; recorded principle: the
  provider is ONE global setting — the selected LLM drives chat AND enrichment,
  no per-feature mixing; settings will pull the model list from `/api/tags`).
- App Store distribution, auto-update, homebrew-core submission.
- Reading existing Obsidian notes into stash (Obsidian reviews stash's folder,
  never the reverse).
- Windows/Linux, mobile, cloud sync (standing v1 cuts).

## Riskiest assumption

The chat-close bug is the resign-key auto-hide firing around response arrival.
T3 sidesteps diagnosis with a defensive fix (suppress hide while chat is
active; reopen into chat); if a deeper focus thief exists it may still bite
elsewhere. Second risk: first-time Tauri signing/notarization pipeline can eat
time (T7 is escalated to the user for credentials).

## Tasks

### T1: Rename notebook → stash
- Type: ship
- Status: landed
- Checkers: round 3 (post-freshness-rebuild) behavioral PASS / audit PASS — merge verified lossless; split-literal + name-field-only manifest flags stand as informational
- Branch: anchor/stash-installable-app-t1
- Escalation: none
<!-- 2026-08-31 reopened at land: freshness conflict with landed T5/T2/T3/T9
     (index.rs, lib.rs); rebuild against current main AFTER T4 lands. Prior
     round-2 verification (PASS/PASS) predates the conflict. -->

- Checkers: round 2 behavioral PASS / audit PASS — flags: manifest/lockfile tripwire (name fields only), disclosed split-literal for legacy dir (spec defect: criteria 1+4 conflict); round 1 split (audit FAIL, repaired). See docs/reports/stash-installable-app-t1-check.md
- Acceptance criteria:
  - `rg -il 'notebook' src src-tauri/src sidecar/src index.html package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml` returns no files (docs/ and node_modules/ exempt).
  - `src-tauri/tauri.conf.json` has `productName` "stash" and bundle `identifier` `land.damo.stash`.
  - Env var overrides are `STASH_VAULT_DIR` and `STASH_MODEL`; config file path is `~/.config/stash/config.json` (same `{"vaultDir": ...}` shape).
  - Vault resolution order (verified by the existing resolution unit tests, renamed and extended): `STASH_VAULT_DIR` → `~/.config/stash/config.json` → `~/Notebook` if that directory exists (legacy fallback, logged) → `~/Stash`.
  - `npm run typecheck` passes and `cargo test` in `src-tauri` passes.

### T2: Overlay joins the active Space
- Type: ship
- Status: landed
- Branch: anchor/stash-installable-app-t2
- Escalation: none
- Checkers: behavioral PASS / audit PASS — flags: none
- Acceptance criteria:
  - The shipped panel setup path in `src-tauri/src/lib.rs` (the code that runs on every real show/toggle, NOT the `shoot_*` screenshot-harness functions) sets `NSWindowCollectionBehavior::CanJoinAllSpaces | FullScreenAuxiliary` on the overlay panel.
  - The comment at the harness-only call site claiming "the shipped overlay has no such behaviour" is updated or removed to match reality.
  - `cargo check` in `src-tauri` passes; `npm run typecheck` passes.

### T3: Chat survives its own answer
- Type: ship
- Status: landed
- Branch: anchor/stash-installable-app-t3
- Escalation: none
- Checkers: behavioral PASS / audit PASS — flags: post-chat reopen always lands in chat + click-outside hide retired while chat view up (literal criteria composition; UX trade for user). See docs/reports/stash-installable-app-t3-check.md
- Acceptance criteria:
  - While a chat turn is in flight OR the chat view is the active view, the resign-key path in `src-tauri/src/lib.rs` does NOT hide the overlay (Esc and Ctrl+W still do; plain-capture resign-hide behaviour unchanged).
  - When the overlay is toggled open and the chat transcript is non-empty, the overlay opens in the chat view (not capture); with an empty transcript it opens in capture as today.
  - The view-restore rule lives in a DOM-free pure function with unit coverage (matching the project's existing pattern of extracting reducers to `src/lib/`), and `npm run typecheck` passes.

### T4: Delete a note (⌘⌫ → Trash)
- Type: ship
- Status: landed
- Checkers: rebuild round behavioral PASS / audit PASS — flags: trash-crate manifest/lockfile only (approved escalation)
<!-- 2026-08-31 reopened at land: freshness conflict with landed T5
     (index.rs, search-view.tsx); rebuild against current main. Prior
     verification (PASS/PASS) predates the conflict. -->

- Checkers: behavioral PASS / audit PASS — flags: dependency manifest + lockfile (trash crate, spec-approved escalation)
- Branch: anchor/stash-installable-app-t4
- Escalation: required — adds a new Rust dependency (`trash` crate or equivalent) for OS-Trash deletion.
- Acceptance criteria:
  - A Tauri command exists that moves a note's `.md` file to the macOS Trash (OS trash — recoverable in Finder — not `fs::remove_file`; e.g. the `trash` crate) and removes it from the SQLite index.
  - ⌘⌫ (Cmd+Backspace) on the selected row in the search results list and the tasks list invokes it; ⌘⌫ inside an open note editor deletes that note and returns to the previous view.
  - Bare Backspace behaviour in inputs is unchanged (still edits text).
  - `cargo test` in `src-tauri` passes and `npm run typecheck` passes.

### T5: Empty search lists all notes
- Type: ship
- Status: landed
- Branch: anchor/stash-installable-app-t5
- Escalation: none
- Checkers: behavioral PASS / audit PASS — flags: none
- Acceptance criteria:
  - Opening search with an empty query lists ALL notes sorted by modified time, newest first (no `/all` command; typing narrows as today; clearing the query returns to the full list).
  - The all-notes query is served by the SQLite index, not a per-keystroke vault directory scan.
  - `npm run typecheck` passes; `cargo test` in `src-tauri` passes.

### T6: First-run wizard + settings (vault picker, Obsidian detection)
- Type: ship
- Status: landed
- Checkers: round 2 (post-fix) behavioral PASS / audit PASS — watcher fix test-proven, no deadlock paths; flags now minor/fail-safe (see report). Round 1 PASS/PASS reopened at land for watcher clobber + ref race, both fixed. See docs/reports/stash-installable-app-t6-check.md
- Branch: anchor/stash-installable-app-t6
- Escalation: none
- Acceptance criteria:
  - On launch with no `~/.config/stash/config.json` and no legacy `~/Notebook`, the app shows a setup view: it parses `~/Library/Application Support/obsidian/obsidian.json` and, when vaults exist, offers `<first-open-obsidian-vault>/stash/` as the suggested vault path; fallback suggestion `~/Stash`; user can type any path.
  - Confirming writes `~/.config/stash/config.json` `{"vaultDir": ...}`, creates the directory, and the running app uses it without restart.
  - The `obsidian.json` → suggested-path logic is a pure function with unit tests covering: no file, empty vaults, one vault, multiple vaults (prefer the one marked open).
  - A tray-menu item "Settings…" reopens the same view later.
  - After a vault switch, the old vault directory's file watcher can no longer overwrite the index: the watcher is stopped or re-pointed to the new directory (or its reindex reads the current vault dir from shared state), and enrichment dispatch follows the current vault dir — with the in-code caveat comment telling the truth about whatever remains.
  - The frontend awaits the vault-dir re-resolution before leaving the setup view, so a capture typed immediately after confirming lands in the newly chosen vault.
  - `npm run typecheck` passes.

### T7: Signed, notarized build + release script
- Type: ship
- Status: landed
- Checkers: behavioral PASS / audit PASS — flags: none (queues on escalation only)
- Branch: anchor/stash-installable-app-t7
- Escalation: required — needs Apple Developer ID credentials and a first interactive notarization run on the user's machine; release script uploads externally.
- Acceptance criteria:
  - `npm run tauri build` produces a `.app`/`.dmg` locally without errors (unsigned build works with no signing env set).
  - `scripts/release.sh` exists: builds, codesigns with Developer ID Application, notarizes via `xcrun notarytool` (credentials from env vars documented at top of script, never hardcoded), staples, and creates/uploads a GitHub release asset via `gh`; a `--dry-run` flag stops before signing/upload and prints the plan.
  - `docs/release.md` documents one-time setup: cert in keychain, `notarytool store-credentials`, required env vars.
  - `npm run typecheck` passes.

### T8: Brew tap cask
- Type: ship
- Status: landed
- Checkers: behavioral PASS / audit PASS — flags: informational only (template hardcodes damo/stash repo + aarch64, disclosed in comments). See docs/reports/stash-installable-app-t8-check.md
- Branch: anchor/stash-installable-app-t8
- Escalation: required — creates/pushes an external public GitHub repo (`damo/homebrew-tap`).
- Acceptance criteria:
  - A cask file `Casks/stash.rb` (template in this repo under `packaging/homebrew/`) installs the `.dmg`/`.app` from a GitHub release URL with `version` and `sha256` fields; `scripts/release.sh` prints (or writes) the updated cask stanza for each release.
  - `docs/release.md` documents the tap flow: `brew tap damo/tap && brew install --cask stash`.
  - Blocked by: T7.

### T9: Graceful degradation without Claude auth
- Type: ship
- Status: landed
- Branch: anchor/stash-installable-app-t9
- Escalation: none
- Checkers: behavioral PASS / audit PASS — flags: sidecar/package.json test-script (tripwire, criterion-serving); auth-regex breadth (pre-existing, cosmetic). See docs/reports/stash-installable-app-t9-check.md
- Acceptance criteria:
  - With no Claude Code OAuth token available, capture, search, tasks, delete, and alerts all work normally (no error dialogs, no crashes).
  - Sending a chat message in that state renders a clear in-transcript message that the LLM is not configured (naming `claude setup-token`) instead of a raw error string.
  - Enrichment in that state skips without writing any marker frontmatter (so a later configured run still enriches) and logs one line; it does not retry-loop.
  - The auth-failure detection is unit-tested in the sidecar (`npm test` in `sidecar/` or the project's existing sidecar test command passes).

## Holds
<!-- decision forks recorded by agents; user resolves at /anchor:land -->
