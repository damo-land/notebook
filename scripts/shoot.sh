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
# Putting content in the shot
# ---------------------------
# The same Accessibility restriction means the harness cannot type either, so
# an empty overlay is all it could otherwise capture. Two more variables drive
# the content through the same hook (`shoot_input` in src-tauri/src/lib.rs):
#
#   SHOOT_TEXT   text placed in the capture input at mount. Use "\n" for a
#                newline. This is how the height-follows-content shots are
#                taken — the window is sized from the rendered content.
#   SHOOT_TYPE   text "typed" after the panel has been dismissed and reopened.
#                Setting it makes the frontend hide the panel, show it again,
#                and then insert this text at the caret of whatever holds DOM
#                focus. Nothing lands unless focus really did come back on the
#                reopen, so the PNG is the proof — and any SHOOT_TEXT seeded
#                beforehand is gone from it, because dismissal clears state.
#                Give the run a longer SHOOT_SETTLE (say 5) so the capture
#                happens after the cycle rather than during it.
#   SHOOT_LABEL  basename for the PNG and dev log, so repeated runs of one view
#                with different text do not overwrite each other.
#
# Example — the overlay at three lines, and the reopen-focus proof:
#
#   SHOOT_TEXT='one\ntwo\nthree' SHOOT_LABEL=height-3 scripts/shoot.sh capture
#   SHOOT_TEXT='draft' SHOOT_TYPE='typed after reopen' SHOOT_SETTLE=5 \
#     SHOOT_LABEL=reopen-focus scripts/shoot.sh capture
#
# Which vault the shot shows
# ---------------------------
# Never the user's own. Each run seeds a small fixture vault and points the app
# at it with NOTEBOOK_VAULT_DIR (honoured by `resolve_vault_dir` ahead of the
# config file and the ~/Notebook default), so a PNG that ends up in a report or
# a commit cannot leak real notes. Override the location with SHOOT_VAULT_DIR.
#
# One side effect worth knowing: the app's index db lives in the app data dir,
# outside whichever vault is in use, so a run leaves it rebuilt from the fixture
# notes. The next normal launch reindexes the real vault on startup and repairs
# it — nothing in the user's vault is touched either way.
#
# Requirements
# ------------
# * Screen Recording permission for the terminal running this script
#   (System Settings -> Privacy & Security -> Screen Recording). Without it
#   `screencapture -l` cannot produce a window image at all; the preflight below
#   fails fast rather than writing a black PNG.
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
# Matched against the app process's argv with `pgrep -f`/`pkill -f`. `tauri dev`
# execs the binary from the repo root by its RELATIVE path, so argv is exactly
# "target/debug/notebook" and this string must stay relative: prefixing it with
# "$REPO_ROOT/src-tauri/" matches nothing and silently disables every guard
# built on it.
APP_BIN_MATCH='target/debug/notebook'
VITE_PORT=1420
# Throwaway vault the app is pointed at for every capture, via the
# NOTEBOOK_VAULT_DIR override in src-tauri/src/index.rs. Screenshots go into
# reports and commits, so they must never contain the user's real notes.
FIXTURE_VAULT="${SHOOT_VAULT_DIR:-$OUT_DIR/fixture-vault}"
# Warm worktree: the app is up in a few seconds. Raise this for the first run
# in a cold worktree, where cargo compiles the whole dependency tree first.
READY_TIMEOUT="${SHOOT_READY_TIMEOUT:-180}"
# Paint + panel fade after the window is on screen.
SETTLE="${SHOOT_SETTLE:-1.2}"
# Whole-launch retries per view when the panel never shows (see shoot_view).
LAUNCH_ATTEMPTS="${SHOOT_LAUNCH_ATTEMPTS:-3}"

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

  # Belt and braces: anything left running the app binary.
  #
  # argv is relative, so this cannot be narrowed to *this* worktree — it would
  # also match a debug build launched from a sibling checkout. Acceptable here:
  # the preflight below refuses to start while any instance is running, so by
  # the time this line runs the only match can be the one we launched.
  pkill -f "$APP_BIN_MATCH" 2>/dev/null || true

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

# INT/TERM exit explicitly. A bash signal handler that merely returns lets the
# script *resume* — and the `for view` loop would then launch a fresh app for
# the next view after the user pressed Ctrl-C, which is the exact leak this
# harness exists to prevent. EXIT stays separate so it still runs on the way out.
trap stop_app EXIT
trap 'stop_app; exit 130' INT TERM

# --- preflight ---------------------------------------------------------------

if ! swift "$REPO_ROOT/scripts/shoot-window.swift" --preflight >/dev/null 2>&1; then
  cat >&2 <<EOF
shoot: no Screen Recording permission for this terminal.

  screencapture cannot produce a window image without it, so this run would
  write nothing (or a black frame). Grant it in
  System Settings -> Privacy & Security -> Screen Recording for the terminal
  app running this script, fully quit and reopen that app, and re-run.

  Set SHOOT_ALLOW_NO_CAPTURE=1 to run anyway — the app still launches and is
  still torn down, and the run fails at the capture step instead. That is only
  useful for exercising the launch/teardown path; it produces no PNG.
EOF
  if [ "${SHOOT_ALLOW_NO_CAPTURE:-}" != "1" ]; then
    exit 1
  fi
  log "SHOOT_ALLOW_NO_CAPTURE=1: continuing without capture permission"
fi

if [ -n "$(port_pids)" ]; then
  echo "shoot: port $VITE_PORT is already in use by pid(s) $(port_pids)." >&2
  echo "       vite is strictPort, so only one instance can run. Free it first." >&2
  exit 1
fi

if pgrep -f "$APP_BIN_MATCH" >/dev/null 2>&1; then
  echo "shoot: a debug build of the app is already running (pid(s) $(pgrep -f "$APP_BIN_MATCH" | tr '\n' ' '))." >&2
  echo "       This app is a tray process with no dock icon, so a leaked instance" >&2
  echo "       is invisible. Quit it from the tray or kill it, then re-run." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# --- fixture vault -----------------------------------------------------------
#
# Every capture runs against a throwaway vault, never the user's real one:
# these PNGs end up in reports and commits. `resolve_vault_dir` honours
# NOTEBOOK_VAULT_DIR ahead of both ~/.config/notebook/config.json and the
# ~/Notebook default (src-tauri/src/index.rs).
#
# Rebuilt from scratch on every run so a shot never inherits a note left by an
# earlier one. Note the `enriched:` marker on the knowledge note: without it the
# app queues a background enrichment job for it on launch, which is a real
# (billable) model call. Fixture notes must never trigger one.
#
# That rebuild is an `rm -rf` on a path the caller controls through
# SHOOT_VAULT_DIR, so it is guarded: the script only deletes a directory it can
# prove it created itself, identified by the marker file below. Point
# SHOOT_VAULT_DIR at a real vault and the run stops with nothing removed.
# A dotfile so `ls | wc -l` still counts notes, and so it cannot be mistaken
# for one (the indexer only reads *.md).
FIXTURE_MARKER=".notebook-shoot-fixture"

# Exits non-zero unless $FIXTURE_VAULT is safe to delete: absent, empty, or
# carrying our marker. Anything else is someone's real directory.
assert_fixture_vault_is_ours() {
  [ -e "$FIXTURE_VAULT" ] || return 0

  if [ ! -d "$FIXTURE_VAULT" ]; then
    echo "shoot: SHOOT_VAULT_DIR ($FIXTURE_VAULT) exists but is not a directory." >&2
    echo "       Refusing to delete it." >&2
    exit 1
  fi
  [ ! -f "$FIXTURE_VAULT/$FIXTURE_MARKER" ] || return 0
  # No marker: only an empty directory is safe to take over.
  [ -z "$(ls -A "$FIXTURE_VAULT" 2>/dev/null)" ] || {
    cat >&2 <<EOF
shoot: refusing to delete $FIXTURE_VAULT

  This run would wipe that directory and reseed it with fixture notes, but it
  has contents and no $FIXTURE_MARKER marker — so this script did not create
  it, and it may be a real vault.

  Point SHOOT_VAULT_DIR at a path this script owns (it writes the marker into
  every vault it seeds), or leave SHOOT_VAULT_DIR unset to use the default
  under the gitignored output directory. If you really do want this directory
  gone, delete it yourself first.
EOF
    exit 1
  }
}

seed_fixture_vault() {
  assert_fixture_vault_is_ours
  rm -rf "$FIXTURE_VAULT"
  mkdir -p "$FIXTURE_VAULT"
  # Written first: from here on this directory is provably ours to rebuild.
  : >"$FIXTURE_VAULT/$FIXTURE_MARKER"

  cat >"$FIXTURE_VAULT/20260101-090000-fixture-espresso.md" <<'EOF'
---
id: 20260101-090000-fixture-espresso
created: 2026-01-01T09:00:00Z
kind: task
tags: [fixture, kitchen]
deadline: 2026-01-09
done: false
---
Descale the espresso machine

Citric acid solution, two full tank cycles, then rinse twice.
EOF

  cat >"$FIXTURE_VAULT/20260101-100000-fixture-passport.md" <<'EOF'
---
id: 20260101-100000-fixture-passport
created: 2026-01-01T10:00:00Z
kind: task
tags: [fixture, admin]
deadline: 2026-02-14
done: false
---
Renew the passport before the Lisbon trip

Photo booth first, then the online form.
EOF

  cat >"$FIXTURE_VAULT/20260101-110000-fixture-sourdough.md" <<'EOF'
---
id: 20260101-110000-fixture-sourdough
created: 2026-01-01T11:00:00Z
kind: task
tags: [fixture, kitchen]
done: true
---
Feed the sourdough starter

1:5:5 by weight, room temperature overnight.
EOF

  cat >"$FIXTURE_VAULT/20260101-120000-fixture-tides.md" <<'EOF'
---
id: 20260101-120000-fixture-tides
created: 2026-01-01T12:00:00Z
kind: knowledge
tags: [fixture, sea]
enriched: 2026-01-01T12:00:00Z
---
Spring tides follow the new and full moon

Sun and moon pull in line, so the range between high and low water is at its
widest. Neap tides, at the quarter moons, are the flattest.
EOF

  log "fixture vault seeded at $FIXTURE_VAULT ($(ls "$FIXTURE_VAULT" | wc -l | tr -d ' ') notes)"
}

seed_fixture_vault

# --- one view ----------------------------------------------------------------

# Sets PANEL to "<windowId>\t<x>,<y>,<w>,<h>" once the app's panel is on screen.
#
# A global rather than a return value on stdout, deliberately: read through
# `$(...)` this would run in a subshell, and bash defers a signal trap until the
# foreground command finishes — so Ctrl-C during the wait would be swallowed
# until the whole poll loop had timed out, and the interrupt would report itself
# as a timeout.
PANEL=""
# 1 when PANEL came from the SHOOT_ALLOW_OFFSCREEN fallback rather than from a
# window the window server is actually compositing.
PANEL_OFFSCREEN=0

# Prints "<windowId>\t<x>,<y>,<w>,<h>" for the app's panel, or nothing.
# `$2` = 1 to allow the uncomposited fallback.
find_panel() {
  local line
  line="$(SHOOT_ALLOW_OFFSCREEN="$2" swift "$REPO_ROOT/scripts/shoot-window.swift" "$1" 2>/dev/null || true)"
  printf '%s' "${line%%$'\n'*}"
}

wait_for_panel() {
  local pgid="$1" log_file="$2" deadline=$((SECONDS + READY_TIMEOUT)) app_pid line last_pid=""
  PANEL=""
  PANEL_OFFSCREEN=0
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
      last_pid="$app_pid"
      line="$(find_panel "$app_pid" "")"
      if [ -n "$line" ]; then
        PANEL="$line"
        return 0
      fi
    fi
    sleep 1
  done

  # Only now, having given the composited path the whole timeout to win.
  if [ "${SHOOT_ALLOW_OFFSCREEN:-}" = "1" ] && [ -n "$last_pid" ]; then
    line="$(find_panel "$last_pid" 1)"
    if [ -n "$line" ]; then
      PANEL="$line"
      PANEL_OFFSCREEN=1
      log "no composited panel after ${READY_TIMEOUT}s; falling back to the uncomposited window"
      return 0
    fi
  fi

  log "the panel did not appear within ${READY_TIMEOUT}s"
  return 1
}

launch_app() {
  local view="$1" log_file="$2"
  set -m # job control: the launch below gets its own process group
  # stdin from /dev/null: a background process group that reads the terminal
  # gets SIGTTIN and stops dead.
  (
    cd "$REPO_ROOT"
    NOTEBOOK_SHOOT_VIEW="$view" \
      NOTEBOOK_SHOOT_TEXT="${SHOOT_TEXT:-}" \
      NOTEBOOK_SHOOT_TYPE="${SHOOT_TYPE:-}" \
      NOTEBOOK_VAULT_DIR="$FIXTURE_VAULT" \
      exec npm run tauri dev
  ) </dev/null >"$log_file" 2>&1 &
  APP_PGID=$!
  set +m
}

capture_panel() {
  local view="$1" png="$2" window_id bounds
  window_id="${PANEL%%$'\t'*}"
  bounds="${PANEL#*$'\t'}"
  log "panel window id $window_id, bounds ${bounds} (x,y,w,h in points)"
  if [ "${SHOOT_ALLOW_OFFSCREEN:-}" = "1" ] && [ "$PANEL_OFFSCREEN" = "1" ]; then
    log "WARNING: this window is NOT composited (SHOOT_ALLOW_OFFSCREEN fallback)."
    log "         The shot is its backing store, so nothing behind it is drawn:"
    log "         readable for content, useless for judging translucency."
  fi

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

  log "wrote $png"
  log "     ${px}x${py} px  (${bw}x${bh} pt, ${scale}x scale)"
}

# One view: launch, wait, capture, tear down — retrying the whole launch if the
# panel never showed. That retry is not paranoia: while the user is working in
# another app, macOS sometimes leaves a backgrounded app's panel undrawn no
# matter how often the app re-presents it, and a fresh launch clears it. Every
# attempt tears its app down before the next one starts.
shoot_view() {
  local view="$1"
  # SHOOT_LABEL names the output, so several runs of the same view — different
  # SHOOT_TEXT, say — do not overwrite each other's PNG.
  local name="${SHOOT_LABEL:-$view}"
  local png="$OUT_DIR/$name.png"
  local log_file="$OUT_DIR/$name.dev.log"
  local attempt

  rm -f "$png"
  for attempt in $(seq 1 "$LAUNCH_ATTEMPTS"); do
    log "launching app for view '$view' (attempt $attempt/$LAUNCH_ATTEMPTS, log: $log_file)"
    launch_app "$view" "$log_file"
    if wait_for_panel "$APP_PGID" "$log_file"; then
      capture_panel "$view" "$png"
      stop_app
      return 0
    fi
    stop_app
  done

  cat >&2 <<EOF
shoot: the overlay panel never appeared for view '$view'.

  If the dev log has no "[shoot] presented the overlay panel" line, the
  frontend hook never ran. If it does, the panel was ordered in but the window
  server did not draw it — that happens while another app holds the foreground,
  and reliably while every display is showing a full-screen app.
  Retrying with the desktop in front usually clears it.

  SHOOT_ALLOW_OFFSCREEN=1 takes the shot anyway, from the window's backing
  store. Use it to read the panel's own content when the desktop cannot be
  cleared; do NOT use it to judge translucency, since nothing behind an
  uncomposited window was ever drawn.

  Also re-check System Settings -> Privacy & Security -> Screen Recording:
  without it CGWindowListCopyWindowInfo withholds the on-screen flag and the
  panel is invisible to this lookup even when it is on screen.

  Dev log: $log_file
EOF
  return 1
}

for view in "${VIEWS[@]}"; do
  shoot_view "$view"
done

log "done: ${#VIEWS[@]} view(s) -> $OUT_DIR"
