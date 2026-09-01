# Context: notebook

Spotlight-style personal note capture + knowledge vault. Resident overlay
(hotkey → type → enter → gone), local markdown vault, Claude-queryable.

## Stack
- App: Tauri v2 (Rust shell) + React/TypeScript UI; `tauri-nspanel` for
  non-activating overlay; official plugins for global hotkey, tray,
  notifications
- Agent: Node sidecar running Claude Agent SDK on Max subscription OAuth
  (`claude setup-token`, no API key) + MCP server exposing vault to Claude
  Code/Desktop
- Vault: local folder of markdown files (YAML frontmatter, `[[wiki-links]]`);
  SQLite index (tasks/filters/search) — derived, always rebuildable from files
- Test command: `npm run typecheck` <!-- repo empty; scaffold task must create
  this script. Until then nothing is runnable — first landed task establishes
  it. -->
- Mode: auto-land

## Terms
- vault: the markdown folder — single source of truth; SQLite is only an index
- note kinds: note (default), knowledge, task — one note model; task = note
  that appears in tasks view, checkable, deadline = silent sort metadata
- alert: opt-in property on any note → macOS notification (the only
  notification mechanism; makes a note a "reminder")
- capture overlay: resident hotkey window; plain text = note; `/` commands
  morph UI (knowledge / task / search / chat)
- enrichment: background Agent SDK pass on knowledge notes — appends only
  (metadata, link expansion, auto-tags, wiki-links), never rewrites user text
- marker frontmatter keys — idempotence contracts; never clobber, never write
  from a stale read: `alerted: true` (alert already fired; dropping it causes a
  duplicate notification) and `enriched: <ts>` (enrichment done; dropping it
  causes re-enrichment and re-spend). Both are written read-modify-write with no
  coordination — see the known race in docs/reports/notebook-v1-t12-check.md
- holo: ~/Desktop/damo/code/holo — old assistant project; spirit reference for
  chat persona (casual, memory-woven), not code to reuse

## Decisions
- 2026-08-27: Replace cogito (browser-locked) with OS-level overlay; mac-only
  v1, architecture stays portable.
- 2026-08-27: Local markdown + SQLite index over Notion-style DB or neo4j —
  neo4j rejected (server ops, holo legacy; wiki-links + SQLite cover it).
- 2026-08-27: LLM via Claude Agent SDK on Max 5x subscription credit — no
  per-token API spend; model call isolated behind one thin module.
- 2026-08-27: Category picked manually at capture via `/` (zero-decision
  default = plain note); LLM does NOT classify.
- 2026-08-28: Cut from v1: mobile, cloud sync, cogito bridge, obsidian plugin,
  win/linux, temp category, extraction mode, drag-drop (keyboard reorder
  later; v1 tasks list = static, deadline-sorted, keyboard category filter).
- 2026-08-28: Chat ships in v1 but is built LAST — thin Agent SDK passthrough
  over vault first; holo-style persona is fast-follow.
- 2026-08-28: Tauri v2 + TS over Swift — TS fluency + UI iteration speed on
  the morphing editor outweigh last ~5% of native overlay feel.
- 2026-09-01: Sidecar ships INSIDE the .app — `scripts/stage-sidecar.sh` stages
  source + `npm ci --omit=dev` into a bundle resource; no bundler, so the
  bundled tree runs identically to dev.
  `node` stays a prerequisite (cask `depends_on`), discovered by explicit path
  because a GUI app inherits no shell PATH.
