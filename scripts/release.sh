#!/usr/bin/env bash
#
# release.sh — build, sign, notarize, staple, and publish a stash release.
#
# Usage:
#   scripts/release.sh            # full release flow
#   scripts/release.sh --dry-run  # print the plan and exit before signing/upload
#
# Required environment variables (put them in .env.local — it is gitignored —
# and `source .env.local` before running; NEVER hardcode credentials here):
#
#   APPLE_SIGNING_IDENTITY   Codesign identity, e.g.
#                            "Developer ID Application: Jane Doe (TEAMID1234)"
#   APPLE_NOTARY_PROFILE     Keychain profile name created with
#                            `xcrun notarytool store-credentials <name>`.
#                            — OR, instead of the profile, all three of: —
#   APPLE_ID                 Apple ID email for notarization
#   APPLE_TEAM_ID            Apple Developer team id
#   APPLE_APP_PASSWORD       App-specific password (appleid.apple.com)
#   GITHUB_REPO              GitHub repo for the release, e.g. "damo/stash"
#
# One-time setup (cert, notary credentials): see docs/release.md.

set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# --- Gather facts -------------------------------------------------------------

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
APP_NAME=$(node -p "require('./src-tauri/tauri.conf.json').productName")
BUNDLE_DIR="src-tauri/target/release/bundle"
APP_PATH="$BUNDLE_DIR/macos/$APP_NAME.app"
# The dmg name embeds the arch (e.g. _aarch64); resolved by glob after build.
DMG_GLOB="$BUNDLE_DIR/dmg/${APP_NAME}_${VERSION}_*.dmg"
TAG="v$VERSION"

# Mask an identity/email for display: keep first 4 chars.
mask() { local s="${1:-<unset>}"; [[ "$s" == "<unset>" ]] && echo "$s" || echo "${s:0:4}****"; }

# --- Dry run: print the plan and stop -----------------------------------------

if $DRY_RUN; then
  if [[ -n "${APPLE_NOTARY_PROFILE:-}" ]]; then
    NOTARY_DESC="keychain profile $(mask "$APPLE_NOTARY_PROFILE")"
  else
    NOTARY_DESC="apple-id $(mask "${APPLE_ID:-}") / team $(mask "${APPLE_TEAM_ID:-}")"
  fi
  cat <<EOF
[dry-run] Release plan for $APP_NAME $VERSION (tag $TAG)

  1. npm run tauri build
       app: $APP_PATH
       dmg: $DMG_GLOB
  2. codesign --deep --force --options runtime \\
       --sign "$(mask "${APPLE_SIGNING_IDENTITY:-}")" (APPLE_SIGNING_IDENTITY) on the .app, then sign the dmg
  3. xcrun notarytool submit --wait
       credentials: $NOTARY_DESC
  4. xcrun stapler staple <dmg>
  5. shasum -a 256 <dmg>   (homebrew cask sha256)
  6. gh release create $TAG <dmg> --generate-notes --repo ${GITHUB_REPO:-<unset>}

[dry-run] Stopping before any signing, notarization, or upload. Nothing was built or published.
EOF
  exit 0
fi

# --- Preflight: fail fast on missing env/tools --------------------------------

: "${APPLE_SIGNING_IDENTITY:?set APPLE_SIGNING_IDENTITY (see header)}"
: "${GITHUB_REPO:?set GITHUB_REPO (see header)}"
if [[ -z "${APPLE_NOTARY_PROFILE:-}" ]]; then
  : "${APPLE_ID:?set APPLE_NOTARY_PROFILE, or APPLE_ID/APPLE_TEAM_ID/APPLE_APP_PASSWORD}"
  : "${APPLE_TEAM_ID:?set APPLE_TEAM_ID}"
  : "${APPLE_APP_PASSWORD:?set APPLE_APP_PASSWORD}"
fi
command -v gh >/dev/null || { echo "error: gh CLI not installed" >&2; exit 1; }
command -v xcrun >/dev/null || { echo "error: xcrun not found (install Xcode CLT)" >&2; exit 1; }

# --- 1. Build -----------------------------------------------------------------
# APPLE_SIGNING_IDENTITY in the env makes tauri sign the .app (and the dmg's
# embedded copy) during the build, so the dmg contains the signed app.

echo "==> Building $APP_NAME $VERSION"
npm run tauri build

[[ -d "$APP_PATH" ]] || { echo "error: expected app at $APP_PATH" >&2; exit 1; }
# Resolve the dmg (exactly one expected for this version).
DMG_PATH=$(ls $DMG_GLOB 2>/dev/null | head -1)
[[ -n "$DMG_PATH" && -f "$DMG_PATH" ]] || { echo "error: expected dmg matching $DMG_GLOB" >&2; exit 1; }

# --- 2. Codesign (belt-and-braces: re-sign even though tauri signed) ----------

echo "==> Codesigning $APP_PATH"
codesign --deep --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"
# Sign the dmg wrapper too so Gatekeeper is happy with the download itself.
codesign --force --sign "$APPLE_SIGNING_IDENTITY" "$DMG_PATH"

# --- 3. Notarize --------------------------------------------------------------

echo "==> Notarizing $DMG_PATH (this can take a few minutes)"
if [[ -n "${APPLE_NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$APPLE_NOTARY_PROFILE" --wait
else
  xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" \
    --wait
fi

# --- 4. Staple ----------------------------------------------------------------

echo "==> Stapling notarization ticket"
xcrun stapler staple "$DMG_PATH"

# --- 5. Homebrew cask sha256 (consumed by the cask definition) ----------------

echo "==> Homebrew cask sha256:"
shasum -a 256 "$DMG_PATH"

# --- 6. GitHub release --------------------------------------------------------

echo "==> Publishing GitHub release $TAG to $GITHUB_REPO"
if gh release view "$TAG" --repo "$GITHUB_REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$DMG_PATH" --clobber --repo "$GITHUB_REPO"
else
  gh release create "$TAG" "$DMG_PATH" --generate-notes --repo "$GITHUB_REPO"
fi

echo "==> Done: $APP_NAME $VERSION released as $TAG"
