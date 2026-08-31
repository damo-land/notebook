# stash

Spotlight-style personal note capture + knowledge vault. Press a hotkey,
type a thought, hit Enter — it's saved as plain markdown in your vault and
the overlay is gone. Tauri v2 (Rust) + React/TypeScript, with a Node sidecar
for the AI features (Claude via your subscription, or local Ollama).

## Install

- From a release: download the dmg, drag `stash.app` to Applications.
- From source: `npm install && npm run tauri build` (artifacts under
  `src-tauri/target/release/bundle/`), or run in dev with `npm run tauri dev`.

First launch opens a two-step setup: pick your vault folder (an existing
Obsidian vault is auto-suggested as `<vault>/stash/`), then your AI provider
and model (defaults: Claude + Haiku — just press Enter twice). Your notes are
plain `.md` files; open the folder in Obsidian any time.

## Using stash

### Summon and dismiss

| Keys | Action |
|---|---|
| `⌥ Space` | Toggle the capture overlay (works on any Space / full-screen app) |
| `⌥⇧ Space` | Open straight into the tasks view |
| `Esc` | Back out one level (menu → view → overlay closed) |
| `⌃W` | Close the overlay from anywhere |

The overlay appears on the display your cursor is on. The tray icon opens
Settings… and quits the app.

### Capture

Type and press `Enter` — a plain note lands in the vault. Type `/` inside
the input for the action menu:

| Command | What it does |
|---|---|
| `/task` | Capture as a task (shows in the tasks view) |
| `/knowledge` | Capture as knowledge (AI-enriched in the background: tags, wiki-links) |
| `/search` | Search the vault |
| `/chat` | Ask the AI about your notes |

Tasks take extra fields via the same `/` menu: `/alert` (macOS notification
at a time), `/deadline` (`fri`, `2026-09-03`, `+3d`), `/category` (a tag).

### Lists (search results, tasks)

| Keys | Action |
|---|---|
| `↑` / `↓` | Move selection |
| `Enter` | Open the selected note in the editor |
| `Space` | (Tasks) mark the selected task done |
| `⌘⌫` | Delete the selected note — goes to the macOS Trash, recoverable |

Search with an empty query lists every note, newest first; typing narrows.
Inside an open note: edit freely, `Esc` closes back to the previous view,
`⌘⌫` deletes the note.

### Chat

`/chat` opens a conversation over your vault — the model searches and reads
your notes to answer. `Enter` sends, `Esc` returns to capture (transcript
kept for the session), `⌃W` closes the overlay. Works with Claude (needs
`claude setup-token` once) or local Ollama (pick a model in Settings; pull
one first, e.g. `ollama pull qwen3:8b`).

### Settings

Tray icon → **Settings…**: vault location, AI provider (Claude / Ollama) and
model, and launch-at-login. Changes apply immediately — no restart.

Environment overrides for power users: `STASH_MODEL` (Claude model),
`STASH_OLLAMA_URL` (Ollama daemon, default `localhost:11434`),
`STASH_VAULT_DIR` (vault path, wins over the config file).

## Dev

Run the app: `npm run tauri dev`

- `npm install` — install dependencies
- `npm run typecheck` — TypeScript typecheck
- `npm run build` — frontend build
- `cargo test` (inside `src-tauri/`) — Rust tests
- `npm test` (inside `sidecar/`) — sidecar tests
- `scripts/release.sh` — signed + notarized release (see `docs/release.md`)
