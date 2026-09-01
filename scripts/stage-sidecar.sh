#!/usr/bin/env bash
#
# Stage the Node sidecar for bundling into the .app.
#
# Why this exists
# ---------------
# The Tauri shell spawns the sidecar as a child process (see spawn_sidecar in
# src-tauri/src/lib.rs). In dev it runs it straight out of ./sidecar; a built
# app cannot, because that path is a compile-time constant pointing into
# whoever's checkout did the build. An installed app therefore had NO sidecar
# at all: every provider probe in the settings view failed, chat and
# enrichment did nothing.
#
# So the sidecar ships inside the bundle. This script produces the exact tree
# that goes in — source plus PRODUCTION dependencies only — under
# src-tauri/sidecar-dist, which tauri.conf.json declares as a bundle resource
# and which the app resolves through resource_dir() at runtime.
#
# What is NOT here
# ----------------
# No bundler. The staged tree runs the same way dev does (`node --import tsx
# src/main.ts`), so there is one runtime story to reason about instead of two,
# and nothing can work in dev but break once bundled by way of a build step.
# The cost is the size of node_modules, which is dominated by the Claude Agent
# SDK's own prebuilt CLI either way.
#
# `node` itself is NOT bundled: it stays a prerequisite (the Homebrew cask
# declares it, and the app discovers it explicitly since a .app inherits no
# shell PATH — see NODE_BINARY_PATHS in src-tauri/src/lib.rs).
#
# Run directly, or via `npm run sidecar:stage`. Tauri's beforeBuildCommand
# calls it, so `npm run tauri build` always bundles a fresh copy.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/sidecar"
# Inside src-tauri so tauri.conf.json can name it with a relative path.
# Gitignored; rebuilt from scratch on every run.
STAGE="$REPO_ROOT/src-tauri/sidecar-dist"

log() { echo "[stage-sidecar] $*"; }

[ -f "$SRC/package.json" ] || {
  echo "stage-sidecar: no sidecar/package.json at $SRC" >&2
  exit 1
}
[ -f "$SRC/package-lock.json" ] || {
  echo "stage-sidecar: no sidecar/package-lock.json — npm ci needs the lockfile" >&2
  exit 1
}

rm -rf "$STAGE"
mkdir -p "$STAGE"

# The manifest pair first: `npm ci` is what makes the staged dependency tree
# reproducible (and what enforces --omit=dev), so it installs against exactly
# the lockfile the repo committed.
cp "$SRC/package.json" "$SRC/package-lock.json" "$STAGE/"
cp -R "$SRC/src" "$STAGE/src"
# tsx reads it for compiler options, so dev and bundled parse identically.
cp "$SRC/tsconfig.json" "$STAGE/tsconfig.json"

log "installing production dependencies into $STAGE"
npm --prefix "$STAGE" ci --omit=dev --no-audit --no-fund

# Proof the tree can actually answer a request, before it is sealed into a
# bundle where a missing dependency only shows up as "sidecar unreachable".
log "smoke: one ping through the staged tree"
PING_REPLY="$(
  printf '{"id":1,"method":"ping"}\n' |
    (cd "$STAGE" && node --import tsx src/main.ts 2>/dev/null) |
    grep -m1 '"id":1'
)"
case "$PING_REPLY" in
  *'"ok":true'*'pong'*) log "smoke OK: $PING_REPLY" ;;
  *)
    echo "stage-sidecar: staged sidecar did not answer ping (got: ${PING_REPLY:-nothing})" >&2
    exit 1
    ;;
esac

log "staged $(du -sh "$STAGE" | cut -f1) at $STAGE"
