# Settings screen overhaul: truthful status, actionable providers, visual polish

Status: draft
Source: Settings screen shows stale/false provider status (one-shot probe races sidecar boot), offers no way to start ollama or authenticate claude, and looks unfinished (native select chrome, uneven gaps, left-hugging layout).

## Goal

Settings screen that is truthful and actionable: provider status re-probes live
until settled, ollama gets a Start button, claude gets `claude setup-token`
guidance when genuinely unauthenticated — all restyled in the existing overlay
design language.

## Non-goals

- Embedded OAuth flow inside the app
- Ollama auto-start on provider selection
- Ollama install flow (missing binary = inline error, nothing more)
- Cross-screen design system pass (settings only)
- Windows/Linux

## Riskiest assumption

Sidecar can spawn `ollama serve` as a detached background process. macOS GUI
apps do not inherit shell PATH, so the ollama binary must be discovered
explicitly (`/opt/homebrew/bin/ollama`, `/usr/local/bin/ollama`, then `PATH`).
Secondary risk: re-probe loop timing vs sidecar boot (status must settle
without reopening the screen).

## Tasks

### T1: Live provider status (kill the probe race)
- Type: ship
- Status: todo
- Branch: —
- Escalation: none
- Acceptance criteria:
  - In `src/components/setup-view.tsx`, the one-shot probe guard (`probedRef`,
    currently around lines 174–179) is replaced by a polling loop: while the
    settings view is open, `claude_auth_status` and `ollama_status` are
    re-invoked on an interval (≤ 5s) until each returns a definitive success,
    and continue at a slower interval (≤ 15s) afterwards so external changes
    (daemon stopped, token revoked) are picked up. Polling stops when the view
    unmounts (no timers leak — verify no interval fires after unmount via a
    cleanup function in the effect).
  - While a probe has not yet succeeded and the sidecar is not yet reachable,
    the status line reads as pending (e.g. "checking…"), NOT as
    "not authenticated" / "not running". The strings "not authenticated" and
    "not running" render only after a completed probe that definitively
    returned false.
  - If the sidecar is not running, the claude status line says so without
    claiming anything about authentication (no "not authenticated — sidecar
    not running" conflation).
  - `npm run typecheck` passes.

### T2: Ollama Start button
- Type: ship
- Status: todo
- Branch: —
- Escalation: none
- Acceptance criteria:
  - When the ollama status line reports not running, a "Start" button renders
    next to it in `src/components/setup-view.tsx`.
  - Clicking Start invokes a new Tauri command in `src-tauri/src/lib.rs` that
    asks the sidecar to spawn `ollama serve` as a detached background process
    (survives sidecar restart is NOT required; must not block the sidecar
    event loop). Implementation lives in `sidecar/src/ollama.ts`.
  - Binary discovery does not rely on inherited shell PATH: checks
    `/opt/homebrew/bin/ollama` and `/usr/local/bin/ollama` explicitly before
    falling back to `PATH` lookup.
  - After a successful spawn, the T1 polling loop flips the status line to
    "running" within 10s without reopening the settings view.
  - If the binary is not found at any location, an inline error message
    renders under the ollama status line (e.g. "ollama not installed") — no
    silent failure, no crash. Error is observable in the UI, not only in logs.
  - While ollama reports running, no Start button renders.
  - `npm run typecheck` passes.
- Blocked by: T1 (needs the polling loop to reflect the spawn result).

### T3: Claude auth guidance
- Type: ship
- Status: todo
- Branch: —
- Escalation: none
- Acceptance criteria:
  - When a completed probe (sidecar reachable, probe returned) definitively
    reports claude unauthenticated, the settings view renders guidance naming
    the exact command `claude setup-token`, plus a button that copies that
    command to the clipboard.
  - The guidance does NOT render while status is pending or when the sidecar
    is unreachable (depends on T1's pending state).
  - After the user authenticates externally, the T1 polling loop flips the
    status to "authenticated" and the guidance disappears without reopening
    the settings view.
  - `npm run typecheck` passes.
- Blocked by: T1 (needs definitive vs pending status distinction).

### T4: Visual restyle
- Type: ship
- Status: todo
- Branch: —
- Escalation: none
- Acceptance criteria:
  - Native `<select>` chrome is gone: provider and model selectors in
    `src/components/setup-view.tsx` are styled (via `src/App.css`) with
    `appearance: none`, custom chevron, dark background consistent with the
    overlay's existing tokens (`--text-primary`, `--hairline`, etc.). No
    default macOS gradient buttons remain.
  - Rows (vault, AI, status, footer) share one consistent horizontal padding
    and vertical rhythm; content uses the window's full width (no dead
    right-hand column) — verified by screenshot.
  - Status lines and any T2/T3 buttons/errors follow the same spacing system.
  - A screenshot of the settings view is produced via the existing tooling
    (`scripts/settings-flow-demo.ts` or `scripts/shoot.sh`) and saved to the
    task report directory; the screenshot shows custom selects and consistent
    spacing.
  - Existing CSS used by other screens (`.field-editor`, `.palette`,
    `.overlay`) is not visually regressed: those class definitions are either
    untouched or changes are additive (new classes/modifiers only).
  - `npm run typecheck` passes.
- Blocked by: T1, T2, T3 (restyles the final DOM including their buttons and
  status states).

## Holds
<!-- decision forks recorded by agents; user resolves at /anchor:land -->
