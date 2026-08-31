# typed: strict
# frozen_string_literal: true

# Homebrew cask TEMPLATE for stash.
#
# This file is the template the release flow updates: scripts/release.sh
# substitutes the release version and dmg sha256 into it and prints the
# resulting stanza. The LIVE copy lives in the tap repo `damo/homebrew-tap`
# as `Casks/stash.rb` — paste the printed stanza there, commit, and push.
# Consumers then: `brew tap damo/tap && brew install --cask stash`.
cask "stash" do
  # version + sha256 are placeholders here; scripts/release.sh fills in the
  # real values for each release (sha256 is `shasum -a 256` of the dmg).
  version "0.1.0"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  # Release asset on GitHub. The repo defaults to damo/stash — change the
  # owner/name in this URL (and homepage) if the app ever moves.
  url "https://github.com/damo/stash/releases/download/v#{version}/stash_#{version}_aarch64.dmg"
  name "stash"
  desc "Spotlight-style note capture with a local markdown vault"
  homepage "https://github.com/damo/stash"

  app "stash.app"

  zap trash: [
    "~/.config/stash",                  # vault location config / app settings
    "~/Library/Caches/land.damo.stash", # app cache (keyed by bundle identifier)
    "~/Library/WebKit/land.damo.stash", # Tauri WKWebView data (local storage, caches)
  ]
end
