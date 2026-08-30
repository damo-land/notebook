#!/usr/bin/env bash
#
# Screenshot harness for the overlay panel.
#
#   scripts/shoot.sh                  # capture view
#   scripts/shoot.sh tasks            # one view
#   scripts/shoot.sh capture tasks search chat editor
#
# For each view it launches `npm run tauri dev`, waits for the overlay panel to
# appear on screen, captures that window (and only that window) to a PNG, and
# tears the whole process tree down again.
#
# How the view is reached
# -----------------------
# The overlay is normally shown by a global hotkey (alt+space), and synthesising
# a hotkey from a script needs macOS Accessibility permission that an unattended
# run cannot grant. So this uses a dev-only test hook instead: the app is
# launched with NOTEBOOK_SHOOT_VIEW=<view>, the frontend reads it via the
# `shoot_view` command, switches to that view, and once React has painted asks
# for the panel via `shoot_show_overlay`. Both commands return/do nothing in a
# release build or when the variable is unset (src-tauri/src/lib.rs).
#
# Because the panel is shown *after* the view has painted, "the panel is on
# screen" is a true readiness signal rather than a guess.
#
# Requirements
# ------------
# * Screen Recording permission for the terminal running this script
#   (System Settings -> Privacy & Security -> Screen Recording). Without it
#   `screencapture -l` cannot produce a window image at all; the preflight below
#   fails fast rather than writing a black PNG.
# * `editor` needs at least one note in the vault (it opens the first one).
#
# Output
# ------
# PNGs land in ./screenshots (gitignored, override with SHOOT_OUT_DIR) and the
# absolute path plus pixel dimensions of each one is printed. Captures are at
# the display's backing scale, so on a Retina screen a 640x320 pt panel comes
# out 1280x640 px — the scale factor is printed with every shot.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${SHOOT_OUT_DIR:-$REPO_ROOT/screenshots}"
APP_BIN_MATCH='target/debug/notebook'
VITE_PORT=1420
# First run in a cold worktree compiles the Rust app; later runs relink only.
READY_TIMEOUT="${SHOOT_READY_TIMEOUT:-420}"
# Paint + panel fade after the window is on screen.
SETTLE="${SHOOT_SETTLE:-1.2}"

# `tauri dev` shells out to cargo, which rustup installs outside the default
# PATH — pick it up so the harness runs from a plain shell.
if ! command -v cargo >/dev/null 2>&1 && [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi

VIEWS=("$@")
if [ ${#VIEWS[@]} -eq 0 ]; then
  VIEWS=(capture)
fi

for view in "${VIEWS[@]}"; do
  case "$view" in
    capture | tasks | search | chat | editor) ;;
    *)
      echo "shoot: unknown view '$view' (capture|tasks|search|chat|editor)" >&2
      exit 2
      ;;
  esac
done

log() { echo "[shoot] $*"; }

# --- teardown ----------------------------------------------------------------
#
# Every launch below runs under job control (`set -m`), so `npm run tauri dev`
# and everything it spawns — the tauri CLI, cargo, vite, esbuild, the app binary
# and the app's node sidecar — share one process group. Killing the group kills
# the tree; killing only the npm parent would leave the app holding port 1420,
# and a leaked instance of this tray app is invisible (no dock icon).
#
# stop_app is idempotent and runs from the EXIT/INT/TERM trap, so it also runs
# when a capture fails or the run is interrupted.

APP_PGID=""

group_pids() { ps -eo pid=,pgid= | awk -v g="$1" '$2 == g { print $1 }'; }

port_pids() { lsof -nP -iTCP:"$VITE_PORT" -sTCP:LISTEN -t 2>/dev/null || true; }

stop_app() {
  local pgid="$APP_PGID"
  APP_PGID=""
  [ -n "$pgid" ] || return 0

  kill -TERM -- "-$pgid" 2>/dev/null || true
  for _ in $(seq 1 50); do
    if [ -z "$(group_pids "$pgid")" ]; then break; fi
    sleep 0.2
  done
  if [ -n "$(group_pids "$pgid")" ]; then
    kill -KILL -- "-$pgid" 2>/dev/null || true
    sleep 0.5
  fi

  # Belt and braces: anything left running this worktree's app binary.
  pkill -f "$REPO_ROOT/src-tauri/$APP_BIN_MATCH" 2>/dev/null || true

  # vite can hold the listening socket for a moment after its process dies, and
  # run N+1 would then hit strictPort. Wait for the port to actually clear; the
  # preflight proved it was free before this run, so whatever still holds it is
  # ours to kill.
  for _ in $(seq 1 75); do
    if [ -z "$(port_pids)" ]; then return 0; fi
    sleep 0.2
  done
  local stuck
  stuck="$(port_pids)"
  if [ -n "$stuck" ]; then
    log "port $VITE_PORT still held by: $stuck — killing"
    # shellcheck disable=SC2086
    kill -KILL $stuck 2>/dev/null || true
    sleep 0.5
  fi
}

trap stop_app EXIT INT TERM

# --- preflight ---------------------------------------------------------------

if ! swift "$REPO_ROOT/scripts/shoot-window.swift" --preflight >/dev/null 2>&1; then
  cat >&2 <<EOF
shoot: no Screen Recording permission for this terminal.

  screencapture cannot produce a window image without it, so this run would
  write nothing (or a black frame). Grant it in
  System Settings -> Privacy & Security -> Screen Recording for the terminal
  app running this script, restart that app, and re-run.
EOF
  exit 1
fi

if [ -n "$(port_pids)" ]; then
  echo "shoot: port $VITE_PORT is already in use by pid(s) $(port_pids)." >&2
  echo "       vite is strictPort, so only one instance can run. Free it first." >&2
  exit 1
fi

if pgrep -f "$REPO_ROOT/src-tauri/$APP_BIN_MATCH" >/dev/null 2>&1; then
  echo "shoot: an instance of this worktree's app is already running." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# --- one view ----------------------------------------------------------------

# Prints "<windowId> <x>,<y>,<w>,<h>" for the app's panel once it is on screen.
wait_for_panel() {
  local pgid="$1" log_file="$2" deadline=$((SECONDS + READY_TIMEOUT)) app_pid line
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ -z "$(group_pids "$pgid")" ]; then
      echo "shoot: the app exited before the panel appeared; see $log_file" >&2
      return 1
    fi
    # No `exit` in the awk and no `| head`: an early-exiting reader SIGPIPEs
    # `ps`, and with `pipefail` that kills this script mid-run, leaving the app
    # behind. Take the first line in the shell instead.
    app_pid="$(ps -eo pid=,pgid=,command= |
      awk -v g="$pgid" -v m="$APP_BIN_MATCH" '$2 == g && index($0, m) { print $1 }')"
    app_pid="${app_pid%%$'\n'*}"
    if [ -n "$app_pid" ]; then
      line="$(swift "$REPO_ROOT/scripts/shoot-window.swift" "$app_pid" 2>/dev/null || true)"
      line="${line%%$'\n'*}"
      if [ -n "$line" ]; then
        printf '%s\n' "$line"
        return 0
      fi
    fi
    sleep 1
  done
  echo "shoot: panel did not appear within ${READY_TIMEOUT}s; see $log_file" >&2
  return 1
}

shoot_view() {
  local view="$1"
  local png="$OUT_DIR/$view.png"
  local log_file="$OUT_DIR/$view.dev.log"

  log "launching app for view '$view' (log: $log_file)"
  rm -f "$png"
  set -m # job control: the launch below gets its own process group
  # stdin from /dev/null: a background process group that reads the terminal
  # gets SIGTTIN and stops dead.
  (
    cd "$REPO_ROOT"
    NOTEBOOK_SHOOT_VIEW="$view" exec npm run tauri dev
  ) </dev/null >"$log_file" 2>&1 &
  APP_PGID=$!
  set +m

  local found window_id bounds
  found="$(wait_for_panel "$APP_PGID" "$log_file")"
  window_id="${found%%$'\t'*}"
  bounds="${found#*$'\t'}"
  log "panel window id $window_id, bounds ${bounds} (x,y,w,h in points)"

  sleep "$SETTLE"
  # -x: no shutter sound. -o: no drop shadow, so the PNG is the panel alone.
  screencapture -x -o -l "$window_id" "$png"
  [ -s "$png" ] || {
    echo "shoot: screencapture wrote nothing for view '$view'" >&2
    return 1
  }

  local px py bw bh scale
  px="$(sips -g pixelWidth "$png" | awk '/pixelWidth/ { print $2 }')"
  py="$(sips -g pixelHeight "$png" | awk '/pixelHeight/ { print $2 }')"
  bw="$(echo "$bounds" | cut -d, -f3)"
  bh="$(echo "$bounds" | cut -d, -f4)"

  # The check that separates "captured the panel" from "captured something
  # else": the image must be exactly the window's own bounds at the display
  # scale. A whole-screen or permission-denied frame fails it.
  scale=$((px / bw))
  if [ "$px" -ne $((bw * scale)) ] || [ "$py" -ne $((bh * scale)) ] || [ "$scale" -lt 1 ]; then
    echo "shoot: capture ${px}x${py}px does not match the panel window ${bw}x${bh}pt" >&2
    return 1
  fi

  stop_app
  log "wrote $png"
  log "     ${px}x${py} px  (${bw}x${bh} pt, ${scale}x scale)"
}

for view in "${VIEWS[@]}"; do
  shoot_view "$view"
done

log "done: ${#VIEWS[@]} view(s) -> $OUT_DIR"
