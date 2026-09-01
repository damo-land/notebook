#!/usr/bin/env bash
# Stage the sidecar's runtime binaries for packaging (consumer-dmg T4).
#
# `tauri.conf.json` bundle.externalBin references `src-tauri/binaries/node` and
# `src-tauri/binaries/claude`; Tauri expects the actual files to carry the
# target-triple suffix (`node-aarch64-apple-darwin`, ...). This script produces
# them:
#
#   * node   — official nodejs.org darwin-arm64 distribution, pinned version,
#              sha256-verified against nodejs.org's SHASUMS256.txt (fetched
#              fresh on every download). Self-contained (only /System and
#              /usr/lib deps — see docs/reports/consumer-dmg-t1-packaging.md).
#   * claude — the Agent SDK's native Claude Code CLI, copied from
#              sidecar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/
#              (run `npm --prefix sidecar install` first). ~207 MB, already
#              codesigned by Anthropic; the Tauri bundler re-signs externalBin.
#
# Everything under src-tauri/binaries/ (including the .cache/ download dir) is
# gitignored — binaries are never committed. Runs as part of
# `npm run sidecar:package`, which `tauri build`'s beforeBuildCommand invokes.
# Idempotent: skips work already done.
set -euo pipefail

NODE_VERSION="22.23.1"
TRIPLE="aarch64-apple-darwin"
DIST="node-v${NODE_VERSION}-darwin-arm64"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$REPO/src-tauri/binaries"
CACHE="$BIN_DIR/.cache"
mkdir -p "$BIN_DIR" "$CACHE"

# --- node runtime -------------------------------------------------------------
NODE_OUT="$BIN_DIR/node-$TRIPLE"
if [ ! -x "$NODE_OUT" ]; then
  TARBALL="$CACHE/$DIST.tar.gz"
  if [ ! -f "$TARBALL" ]; then
    echo "[stage-sidecar-runtime] downloading $DIST.tar.gz from nodejs.org"
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${DIST}.tar.gz" -o "$TARBALL.tmp"
    mv "$TARBALL.tmp" "$TARBALL"
  fi
  echo "[stage-sidecar-runtime] verifying sha256 against nodejs.org SHASUMS256.txt"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "$CACHE/SHASUMS256.txt"
  EXPECTED="$(awk -v f="$DIST.tar.gz" '$2 == f {print $1}' "$CACHE/SHASUMS256.txt")"
  if [ -z "$EXPECTED" ]; then
    echo "[stage-sidecar-runtime] ERROR: $DIST.tar.gz not listed in SHASUMS256.txt" >&2
    exit 1
  fi
  ACTUAL="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "[stage-sidecar-runtime] ERROR: sha256 mismatch for $TARBALL" >&2
    echo "  expected: $EXPECTED" >&2
    echo "  actual:   $ACTUAL" >&2
    rm -f "$TARBALL"
    exit 1
  fi
  tar -xzf "$TARBALL" -C "$CACHE" "$DIST/bin/node"
  cp -f "$CACHE/$DIST/bin/node" "$NODE_OUT"
  chmod +x "$NODE_OUT"
  echo "[stage-sidecar-runtime] staged $NODE_OUT"
fi

# --- claude CLI (Agent SDK native binary) ------------------------------------
CLAUDE_SRC="$REPO/sidecar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude"
CLAUDE_OUT="$BIN_DIR/claude-$TRIPLE"
if [ ! -f "$CLAUDE_SRC" ]; then
  echo "[stage-sidecar-runtime] ERROR: $CLAUDE_SRC not found — run: npm --prefix sidecar install" >&2
  exit 1
fi
if [ ! -f "$CLAUDE_OUT" ] || ! cmp -s "$CLAUDE_SRC" "$CLAUDE_OUT"; then
  cp -f "$CLAUDE_SRC" "$CLAUDE_OUT"
  chmod +x "$CLAUDE_OUT"
  echo "[stage-sidecar-runtime] staged $CLAUDE_OUT"
fi

echo "[stage-sidecar-runtime] done"
