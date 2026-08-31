# Releasing stash

How to cut a signed, notarized macOS release of stash. The whole flow lives in
`scripts/release.sh`; this page covers the one-time setup it needs and the
caveats to know about.

## Quick reference

```sh
source .env.local            # your credentials (see below)
scripts/release.sh --dry-run # print the plan, touch nothing
scripts/release.sh           # build → sign → notarize → staple → GitHub release
```

A plain local build (unsigned, no credentials needed):

```sh
npm run tauri build
# outputs:
#   src-tauri/target/release/bundle/macos/stash.app
#   src-tauri/target/release/bundle/dmg/stash_<version>_<arch>.dmg
```

## One-time setup

### 1. Developer ID certificate in your keychain

You need a **Developer ID Application** certificate (not "Apple Development" —
that one is for local dev only and won't pass Gatekeeper outside your machine).

1. In your [Apple Developer account](https://developer.apple.com/account/resources/certificates/list),
   create a *Developer ID Application* certificate (Xcode → Settings →
   Accounts → Manage Certificates also works).
2. Download and double-click it so it lands in your login keychain.
3. Verify it is visible to codesign:

   ```sh
   security find-identity -v -p codesigning
   # look for: "Developer ID Application: Your Name (TEAMID1234)"
   ```

That full quoted string is your `APPLE_SIGNING_IDENTITY`.

### 2. Notarization credentials

Create an [app-specific password](https://appleid.apple.com) for your Apple ID,
then store the credentials once in your keychain under a named profile:

```sh
xcrun notarytool store-credentials stash-notary \
  --apple-id you@example.com \
  --team-id TEAMID1234
# prompts for the app-specific password, stores everything in the keychain
```

The profile name (`stash-notary` here) is your `APPLE_NOTARY_PROFILE`.

Alternatively, skip the profile and export `APPLE_ID`, `APPLE_TEAM_ID`, and
`APPLE_APP_PASSWORD` directly — the script accepts either.

### 3. GitHub CLI

The release upload uses `gh`. Install it (`brew install gh`) and run
`gh auth login` once.

### 4. Environment variables

Put these in `.env.local` at the repo root (gitignored — never commit
credentials) and `source .env.local` before releasing:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID1234)"
export APPLE_NOTARY_PROFILE="stash-notary"   # or APPLE_ID + APPLE_TEAM_ID + APPLE_APP_PASSWORD
export GITHUB_REPO="damo/stash"
```

## What the script does

1. Reads the version from `src-tauri/tauri.conf.json` (bump it there before
   releasing; the tag is `v<version>`).
2. `npm run tauri build` — with `APPLE_SIGNING_IDENTITY` in the env, Tauri
   signs the app during the build, so the dmg contains a signed copy.
3. Re-runs `codesign --deep --force --options runtime` on the `.app` and signs
   the dmg wrapper.
4. `xcrun notarytool submit --wait` on the dmg, then `xcrun stapler staple`.
5. Prints the dmg's `shasum -a 256` — this is the sha256 the Homebrew cask
   needs.
6. Prints the updated Homebrew cask stanza (the `packaging/homebrew/stash.rb`
   template with the new version and sha256 substituted) — paste it into the
   tap repo, see [Homebrew tap](#homebrew-tap) below.
7. `gh release create v<version> <dmg> --generate-notes` (or uploads to the
   release if the tag already exists).

`--dry-run` prints all of the above with resolved versions/paths (identities
masked) and exits before anything is signed or uploaded.

## Homebrew tap

Users install stash through a personal tap; the cask points at the dmg on the
GitHub release. The cask template lives in this repo at
`packaging/homebrew/stash.rb`; the live copy lives in the tap repo.

### One-time setup

1. Create a GitHub repo named `damo/homebrew-tap` (the `homebrew-` prefix is
   what makes `brew tap damo/tap` resolve to
   `github.com/damo/homebrew-tap`).
2. Copy `packaging/homebrew/stash.rb` into it as `Casks/stash.rb` (drop the
   template header comment), commit, push.

### Per release

1. Run `scripts/release.sh` — after the sha256 it prints the full updated
   cask stanza with the new version and dmg sha256 substituted.
2. Paste that stanza over the contents of `Casks/stash.rb` in
   `damo/homebrew-tap`, commit, push. Done — the tap serves the new version.

### Consumer side

```sh
brew tap damo/tap          # resolves to github.com/damo/homebrew-tap
brew install --cask stash
```

`--no-quarantine` is NOT needed: releases are signed and notarized, so
Gatekeeper accepts the app as-is.

## Known limitations

- **The Node sidecar is NOT bundled into the .app.** The app spawns it via
  `node` from the repo-relative `sidecar/` directory (a dev-time path compiled
  into the binary — see `sidecar_dir()` in `src-tauri/src/lib.rs`). A packaged
  app on another machine — or outside this checkout — will not find it and
  runs in the degraded no-sidecar mode (notes work; agent/enrichment features
  are unavailable). Bundling the sidecar as a proper Tauri sidecar binary is a
  separate future task.
- The dmg is built for the host architecture only (Apple Silicon on the
  maintainer's machine); no universal binary yet.
- No CI: releases are cut manually from a maintainer's machine.
