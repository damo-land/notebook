# T8 check — Brew tap cask

Branch: anchor/stash-installable-app-t8 (commit 0a5a580)
Verdicts: behavioral PASS / audit PASS. Verified; queues at /anchor:land on
the recorded escalation (external damo/homebrew-tap repo push is
user-performed).

## Flags (informational)

- Template hardcodes `damo/stash` (url/homepage) and `aarch64` in the dmg
  filename — a repo rename or Intel build would produce a stale cask URL.
  Disclosed in the template's own comments; fine for N=1 maintainer now.
- release.sh step 5 (shasum) modified from pure-print to capture-and-print
  (`awk` into `$DMG_SHA`); behavior under `set -euo pipefail` unchanged.

## Evidence highlights

- `packaging/homebrew/stash.rb`: version/sha256/url with Ruby `#{version}`
  interpolation, app "stash.app", zap entries verified safe against source —
  `~/.config/stash` holds only the vaultDir pointer (vault itself lives
  outside), cache/WebKit paths match identifier land.damo.stash.
- `print_cask_stanza` (release.sh:47-55): pure local sed; substitution proven
  with synthetic 9.9.9/deadbeef values by BOTH checkers independently; url
  line and zap block pass through unmodified. Dry-run exit 0 shows step 6
  stanza preview; no network paths added (grep: no curl/wget/git push/gh repo
  create).
- docs/release.md "Homebrew tap": one-time setup, per-release paste flow,
  consumer `brew tap damo/tap` + `brew install --cask stash`; notes
  --no-quarantine unnecessary (notarized).
- brew style: no offenses. typecheck clean. Worktree clean. Diff = 3 files,
  all criterion-covered.
