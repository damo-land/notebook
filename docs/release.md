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

A plain local build (unsigned, no credentials needed) — from a clean checkout
all it takes is `npm install` at the repo root (its `postinstall` installs the
sidecar's dependencies too; no manual sidecar step), plus cargo on PATH:

```sh
npm install
npm run tauri build
# outputs (self-contained: node + claude runtimes and the sidecar bundle
# are inside the .app; the dmg is ~120 MB because of them):
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
   releasing; the tag is `v<version>`). Ensures cargo is on PATH (extends it
   with `~/.cargo/bin` if needed, fails early otherwise — npm-spawned
   `tauri build` inherits the script's PATH).
2. `npm run tauri build` — the `beforeBuildCommand` bundles the sidecar
   (`sidecar-bundle.mjs`) and stages the node + claude runtimes into the
   `.app`; with `APPLE_SIGNING_IDENTITY` in the env, Tauri signs the app
   *and* the bundled node/claude executables with the JIT entitlements from
   `src-tauri/entitlements.plist` during the build, so the dmg contains a
   correctly signed copy.
3. Targeted re-sign of the `.app` — **never `codesign --deep`**: a deep
   re-sign stamps nested code with no entitlements, stripping
   `com.apple.security.cs.allow-jit` / `allow-unsigned-executable-memory`
   from the bundled node and claude (both embed JIT runtimes and crash on
   launch without them). Instead the script signs inside-out: node and
   claude individually with `--options runtime` and the entitlements file,
   then the `.app` itself; verifies the signature and asserts the JIT
   entitlements survived; mounts the dmg read-only and asserts its embedded
   copy (Tauri's build-time signature) carries them too; then signs the dmg
   wrapper.
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

## Clean-machine acceptance checklist (manual release gate)

The release is not done when the dmg is uploaded. Before announcing it (or
updating the tap), run this checklist on a **fresh macOS user account** (or a
clean machine) — one with no node, no repo checkout, no dev tools:

1. **Install from the dmg**: download the released dmg, open it, drag
   stash.app to Applications, launch it. It must open without Gatekeeper
   warnings (signed + notarized) and without errors.
2. **Capture works**: invoke the capture window, type a note, save it. The
   note lands in the vault; no error states anywhere. This exercises the
   bundled sidecar — the app ships its own node runtime and sidecar bundle,
   so this must work with nothing else installed.
3. **Ollama detected when running**: start Ollama (`ollama serve` or the
   desktop app), open Settings — the Ollama provider must show as detected.
   Ollama is optional: without it the app still works (this is why the cask
   has no dependency on it).
4. **`--` disables AI**: in Settings pick the `--` provider (AI off). Capture
   still works; no AI calls, no errors.

Any failure here blocks the release: fix, re-run `scripts/release.sh`, and
re-check.

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

## App icon

The bundled icon set in `src-tauri/icons/` is generated from a single source
image; the generated set is what ships, the source is not committed.

Requirements for the source image:

- **1024×1024 PNG** (exact — the regen script refuses anything else).
- Keep the actual artwork within roughly **80% of the canvas**: macOS renders
  app icons with an inset rounded-rect mask, so art that runs to the edges
  looks oversized next to other Dock icons.

To update the icon:

1. Drop the source image at `packaging/icon.png`.
2. Run:

   ```sh
   scripts/regen-icons.sh
   ```

The script validates the dimensions, runs `npx tauri icon packaging/icon.png`,
and leaves the regenerated set in `src-tauri/icons/`. Review and commit the
changed files under `src-tauri/icons/`. Rerun anytime the source changes — it
is idempotent.

## Environment overrides

Runtime overrides the app (and its sidecar) honor; useful when testing a
build against non-default LLM endpoints:

- `STASH_MODEL` — overrides the configured model on the Claude path
  (precedence: explicit per-call model > `STASH_MODEL` > configured model >
  default).
- `STASH_OLLAMA_URL` — the Ollama daemon URL (default
  `http://localhost:11434`). The settings probe and the actual prompt/chat
  traffic resolve through the same helper, so the status line and real
  traffic always agree.

## Known limitations

- The dmg is built for the host architecture only (Apple Silicon on the
  maintainer's machine); no universal binary yet.
- No CI: releases are cut manually from a maintainer's machine.

(The Node sidecar IS bundled: the .app ships its own node runtime, the claude
CLI, and the esbuild'd sidecar bundle — consumers need nothing installed.)
