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
#
# The .app is self-contained: `npm run tauri build`'s beforeBuildCommand
# bundles the sidecar (esbuild → Resources/sidecar/sidecar-bundle.mjs) and
# stages the node + claude runtimes (scripts/stage-sidecar-runtime.sh →
# Contents/MacOS/{node,claude} via bundle.externalBin). Sidecar deps arrive
# through the root `npm install` (postinstall) — no manual sidecar step.

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
CASK_TEMPLATE="packaging/homebrew/stash.rb"
ENTITLEMENTS="src-tauri/entitlements.plist"
# The bundled sidecar runtimes (tauri.conf.json bundle.externalBin). Both are
# JS engines with JIT compilers (V8 / JavaScriptCore) — under the hardened
# runtime they need the JIT entitlements in $ENTITLEMENTS or they crash at
# startup. Tauri signs them with that plist during the build; every signing
# step below must preserve it.
JIT_BINS=(node claude)

# Mask an identity/email for display: keep first 4 chars.
mask() { local s="${1:-<unset>}"; [[ "$s" == "<unset>" ]] && echo "$s" || echo "${s:0:4}****"; }

# Release builds need cargo. npm-spawned `tauri build` inherits this shell's
# PATH, and a bare environment (fresh terminal, CI, launchd) often lacks
# ~/.cargo/bin — extend PATH if we can, otherwise fail early with a clear
# message instead of dying minutes into the build.
ensure_cargo() {
  if ! command -v cargo >/dev/null 2>&1; then
    if [[ -x "$HOME/.cargo/bin/cargo" ]]; then
      export PATH="$HOME/.cargo/bin:$PATH"
    else
      echo "error: cargo not found on PATH and ~/.cargo/bin/cargo does not exist." >&2
      echo "       Install Rust (https://rustup.rs) or add cargo to PATH, then re-run." >&2
      exit 1
    fi
  fi
}

# Print the cask stanza from the template with version + sha256 substituted.
# Skips the template's header comment so the output is paste-ready for the
# tap repo (damo/homebrew-tap, Casks/stash.rb).
print_cask_stanza() {
  local version="$1" sha="$2"
  sed -n '/^cask "stash" do$/,$p' "$CASK_TEMPLATE" |
    sed -e "s/^\(  version \).*/\1\"$version\"/" \
        -e "s/^\(  sha256 \).*/\1\"$sha\"/"
}

# Assert that a signed Mach-O still carries the JIT entitlements. Signing
# mistakes here are silent until the app crashes on a consumer machine, so
# fail the release instead.
assert_jit_entitlements() {
  local exe="$1"
  if ! codesign -d --entitlements :- "$exe" 2>/dev/null |
      grep -q "com.apple.security.cs.allow-jit"; then
    echo "error: $exe is missing the JIT entitlements ($ENTITLEMENTS)." >&2
    echo "       A blanket/deep re-sign likely stripped them; aborting." >&2
    exit 1
  fi
}

# --- Dry run: print the plan and stop -----------------------------------------

if $DRY_RUN; then
  if [[ -n "${APPLE_NOTARY_PROFILE:-}" ]]; then
    NOTARY_DESC="keychain profile $(mask "$APPLE_NOTARY_PROFILE")"
  else
    NOTARY_DESC="apple-id $(mask "${APPLE_ID:-}") / team $(mask "${APPLE_TEAM_ID:-}")"
  fi
  if command -v cargo >/dev/null 2>&1; then
    CARGO_DESC="$(command -v cargo)"
  elif [[ -x "$HOME/.cargo/bin/cargo" ]]; then
    CARGO_DESC="not on PATH — will use ~/.cargo/bin (PATH extended automatically)"
  else
    CARGO_DESC="NOT FOUND — the real run will fail early (install via rustup)"
  fi
  cat <<EOF
[dry-run] Release plan for $APP_NAME $VERSION (tag $TAG)

  0. preflight: cargo on PATH ($CARGO_DESC)
  1. npm run tauri build
       beforeBuildCommand bundles the sidecar and stages the node + claude
       runtimes (sidecar deps come from root npm install's postinstall —
       no manual sidecar step)
       app: $APP_PATH  (self-contained: Contents/MacOS/{node,claude} +
            Contents/Resources/sidecar/sidecar-bundle.mjs)
       dmg: $DMG_GLOB  (~120 MB — runtimes included)
       APPLE_SIGNING_IDENTITY in the env makes Tauri sign the app and the
       bundled node/claude with $ENTITLEMENTS (JIT entitlements) during
       the build, so the dmg embeds a correctly signed app.
  2. codesign (targeted, NO --deep: a deep re-sign would strip the JIT
       entitlements from node/claude and the app would crash on launch)
       identity: $(mask "${APPLE_SIGNING_IDENTITY:-}") (APPLE_SIGNING_IDENTITY)
       a. each of Contents/MacOS/{node,claude}: codesign --force
          --options runtime --timestamp --entitlements $ENTITLEMENTS
       b. the .app itself (same flags, seals the bundle last)
       c. codesign --verify --deep --strict, then assert the JIT
          entitlements survived on the .app and on node/claude
       d. mount the dmg read-only and assert its embedded copy (signed by
          Tauri at build time) kept the JIT entitlements too
       e. sign the dmg wrapper itself
  3. xcrun notarytool submit --wait
       credentials: $NOTARY_DESC
  4. xcrun stapler staple <dmg>
  5. shasum -a 256 <dmg>   (homebrew cask sha256)
  6. print updated Homebrew cask stanza ($CASK_TEMPLATE with version $VERSION
       and the dmg sha256 substituted) — paste into damo/homebrew-tap Casks/stash.rb
  7. gh release create $TAG <dmg> --generate-notes --repo ${GITHUB_REPO:-<unset>}
  8. manual gate before announcing: clean-machine acceptance checklist in
       docs/release.md (fresh macOS account: install dmg → capture works;
       Ollama running → detected; provider "--" disables AI)

[dry-run] Cask stanza preview (placeholder sha256, nothing computed):

$(print_cask_stanza "$VERSION" "<sha256-of-dmg>")

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
ensure_cargo

# --- 1. Build -----------------------------------------------------------------
# APPLE_SIGNING_IDENTITY in the env makes tauri sign the .app AND its bundled
# externalBin (node, claude — with the JIT entitlements from
# src-tauri/entitlements.plist) during the build, so the dmg's embedded copy
# of the app is already correctly signed. beforeBuildCommand bundles the
# sidecar and stages the runtimes; nothing to do by hand.

echo "==> Building $APP_NAME $VERSION"
npm run tauri build

[[ -d "$APP_PATH" ]] || { echo "error: expected app at $APP_PATH" >&2; exit 1; }
# Resolve the dmg (exactly one expected for this version).
DMG_PATH=$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -name "${APP_NAME}_${VERSION}_*.dmg" 2>/dev/null | head -1)
[[ -n "$DMG_PATH" && -f "$DMG_PATH" ]] || { echo "error: expected dmg matching $DMG_GLOB" >&2; exit 1; }

# --- 2. Codesign (targeted; belt-and-braces over tauri's build-time signing) --
# Deliberately NOT `codesign --deep --force`: --deep re-signs every nested
# Mach-O with the OUTER invocation's entitlements — i.e. none, since the app's
# entitlements file can't be right for nested code in general — which strips
# com.apple.security.cs.allow-jit / allow-unsigned-executable-memory from the
# bundled node and claude executables. Both embed JIT runtimes (V8 /
# JavaScriptCore) and crash on launch under the hardened runtime without those
# entitlements. Apple's guidance is the same: sign inside-out, each executable
# with its own entitlements, never --deep for distribution.
#
# So: re-sign the nested runtimes individually WITH the entitlements file,
# then the .app itself (sealing the bundle), then verify — including an
# explicit check that the JIT entitlements survived.

echo "==> Codesigning $APP_PATH (targeted, no --deep)"
for bin in "${JIT_BINS[@]}"; do
  codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" \
    --sign "$APPLE_SIGNING_IDENTITY" \
    "$APP_PATH/Contents/MacOS/$bin"
done
# Any frameworks/dylibs Tauri bundled: hardened runtime, no entitlements
# (libraries don't take entitlements; only main executables do).
if [[ -d "$APP_PATH/Contents/Frameworks" ]]; then
  find "$APP_PATH/Contents/Frameworks" -type f \( -name "*.dylib" -o -perm +111 \) \
    -exec codesign --force --options runtime --timestamp \
      --sign "$APPLE_SIGNING_IDENTITY" {} +
fi
# The .app last — signs the main executable (which also needs the JIT
# entitlements: tauri.conf.json applies this same plist to it) and seals the
# bundle over the freshly signed nested code.
codesign --force --options runtime --timestamp \
  --entitlements "$ENTITLEMENTS" \
  --sign "$APPLE_SIGNING_IDENTITY" \
  "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"
assert_jit_entitlements "$APP_PATH/Contents/MacOS/$APP_NAME"
for bin in "${JIT_BINS[@]}"; do
  assert_jit_entitlements "$APP_PATH/Contents/MacOS/$bin"
done

# The dmg embeds the copy Tauri signed at BUILD time — the re-sign above does
# not reach it. Mount it read-only and assert that copy also carries the JIT
# entitlements before spending minutes on notarization; if this fails, the
# build-time signing is broken and the release must not ship.
echo "==> Verifying signed app inside $DMG_PATH"
MOUNT_POINT=$(mktemp -d /tmp/stash-release-dmg.XXXXXX)
hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_POINT" >/dev/null
trap 'hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true; rmdir "$MOUNT_POINT" 2>/dev/null || true' EXIT
codesign --verify --deep --strict "$MOUNT_POINT/$APP_NAME.app"
for bin in "${JIT_BINS[@]}"; do
  assert_jit_entitlements "$MOUNT_POINT/$APP_NAME.app/Contents/MacOS/$bin"
done
hdiutil detach "$MOUNT_POINT" >/dev/null
rmdir "$MOUNT_POINT" 2>/dev/null || true
trap - EXIT

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
DMG_SHA=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')
echo "$DMG_SHA  $DMG_PATH"

# --- 6. Homebrew cask stanza --------------------------------------------------
# Paste this over the contents of Casks/stash.rb in damo/homebrew-tap,
# then commit and push there (see docs/release.md, "Homebrew tap").

echo "==> Updated Homebrew cask stanza (paste into damo/homebrew-tap Casks/stash.rb):"
print_cask_stanza "$VERSION" "$DMG_SHA"

# --- 7. GitHub release --------------------------------------------------------

echo "==> Publishing GitHub release $TAG to $GITHUB_REPO"
if gh release view "$TAG" --repo "$GITHUB_REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$DMG_PATH" --clobber --repo "$GITHUB_REPO"
else
  gh release create "$TAG" "$DMG_PATH" --generate-notes --repo "$GITHUB_REPO"
fi

echo "==> Done: $APP_NAME $VERSION released as $TAG"
echo "==> Before announcing: run the clean-machine acceptance checklist (docs/release.md)."
