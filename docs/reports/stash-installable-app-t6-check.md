# T6 check — First-run wizard + settings

## Round 2 (2026-08-31, after reopen-fix df067db + 9eaca72): PASS / PASS

Both round-1 hazards fixed and re-verified by fresh checkers:
- Watcher: vault dir now one shared Arc<Mutex<PathBuf>> read at call time by
  watcher_reindex, enrichment worker, and dispatch; watcher re-registered on
  switch (unwatch old best-effort, watch new). Regression test
  `watcher_reindex_follows_the_current_shared_vault_dir` green. Audit found
  no nested-lock/deadlock path (strictly sequential acquisition) and no
  false claims in the updated caveat comment.
- Frontend: onDone awaits getVaultDir into vaultDirRef BEFORE leaving setup;
  rejection keeps the view on setup with an error.
Remaining flags — minor, fail-safe: demo assert script not wired to any
runner/CI (repo-wide convention); in-flight enrich job for an abandoned
vault is dropped safely (clampToVault); swallowed unwatch failure = wasted
watching only; config.json written before create_dir_all — a mkdir failure
would suppress the wizard on next launch (recover by editing/removing
~/.config/stash/config.json). Recommendation: merge as-is; no third cycle.

## Round 1 (superseded)

Branch: anchor/stash-installable-app-t6 (commits a4d0e04, 618a11b, aad6838)
Verdicts: behavioral PASS / audit PASS. All five criteria met as written.
Flags below block auto-land — queues at /anchor:land.

## Flags (audit)

1. SERIOUS — watcher clobber on vault switch: `spawn_watcher`
   (src-tauri/src/index.rs:406-437) closes over the launch-time vault dir for
   the app's lifetime and shares the index connection. After `set_vault_dir`,
   any fs event in the OLD directory (.DS_Store, Spotlight) triggers a full
   reindex of the OLD dir — silently overwriting the NEW vault's index;
   search/tasks/alerts revert to old-vault contents with no error. The code
   comment (lib.rs:885-893) claims only "external edits to the new vault wait
   for restart" — materially understates this. Enrichment worker has the same
   staleness: notes captured into the new vault never get enrichment
   dispatched (watcher-triggered only).
2. Race — post-setup capture: App.tsx onDone (617-630) updates
   `vaultDirRef.current` in an un-awaited async IIFE before switching views;
   a capture typed immediately after confirming can land in the pre-switch
   dir.
3. `needs_setup` bypassed when `STASH_VAULT_DIR` set (consistent with the
   existing override convention; not in the criterion's wording).
4. Comment references "manual reindex" but no UI trigger for the `reindex`
   command exists.
5. Pre-existing tilde-expansion naivety reused; bare relative user paths
   resolve against process CWD, unvalidated.
6. `scripts/` (incl. the new demo asserts) sits outside tsconfig include —
   demo runs only via manual `npx tsx` (repo-wide convention, noted).

Recommended: reopen for one repair before merging — (a) on vault switch,
re-register or kill the old watcher (or gate its reindex on the CURRENT
vault_dir from IndexState), and fix the enrichment-dispatch staleness or
downgrade the code comment to the truth; (b) await the vaultDirRef refresh
before leaving the setup view. Flags 3-6 acceptable as-is.

## Evidence highlights

- Suggestion logic pure + all four cases genuinely asserted
  (scripts/obsidian-vaults-demo.ts, green). needs_setup gates exactly on
  config/legacy/env absence. `set_vault_dir` atomic-writes config
  (stage→sync_all→rename verified), create_dir_all, Mutex swap + reindex.
- Tray "Settings…" → open_settings_view → same SetupView (Esc enabled when
  not first-run). typecheck + cargo test green both lenses; worktree clean;
  diff = 6 files, no out-of-scope changes, no dependency/manifest touches.
