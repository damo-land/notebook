#!/usr/bin/env bash
#
# regen-icons.sh — regenerate the full app icon set from packaging/icon.png.
#
# Usage:
#   scripts/regen-icons.sh
#
# Expects packaging/icon.png to be a 1024×1024 PNG (see docs/release.md,
# "App icon"). Runs `npx tauri icon` and leaves the regenerated set in
# src-tauri/icons/. Idempotent — rerun whenever the source icon changes.

set -euo pipefail

cd "$(dirname "$0")/.."

ICON="packaging/icon.png"

# --- Validate the source icon -------------------------------------------------

if [[ ! -f "$ICON" ]]; then
  echo "error: $ICON not found." >&2
  echo "       Drop a 1024×1024 PNG at $ICON and rerun (see docs/release.md, \"App icon\")." >&2
  exit 1
fi

WIDTH=$(sips -g pixelWidth "$ICON" | awk '/pixelWidth/ {print $2}')
HEIGHT=$(sips -g pixelHeight "$ICON" | awk '/pixelHeight/ {print $2}')

if [[ "$WIDTH" != "1024" || "$HEIGHT" != "1024" ]]; then
  echo "error: $ICON is ${WIDTH}x${HEIGHT}, expected 1024x1024." >&2
  echo "       Export the icon at exactly 1024×1024 and rerun." >&2
  exit 1
fi

# --- Regenerate ---------------------------------------------------------------

echo "==> Regenerating icon set from $ICON"
npx tauri icon "$ICON"

echo "==> Regenerated files in src-tauri/icons/:"
git status --short src-tauri/icons/ || ls -1 src-tauri/icons/

echo "==> Done. Review the changes and commit src-tauri/icons/."
