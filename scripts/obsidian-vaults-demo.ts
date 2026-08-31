// Demo/verification for the T6 vault-path suggestion. Run: npx tsx scripts/obsidian-vaults-demo.ts
//
// Proves the pure rule (src/lib/obsidian-vaults.ts) the setup view pre-fills
// its path input with: parse Obsidian's vault registry
// (~/Library/Application Support/obsidian/obsidian.json) and suggest
// `<open-vault>/stash/`; without a usable registry, fall back to `~/Stash`.

import assert from "node:assert";
import { suggestVaultPath } from "../src/lib/obsidian-vaults";

const HOME = "/Users/demo";

// No file (the read failed, the caller passes null): fallback ~/Stash.
assert.strictEqual(suggestVaultPath(null, HOME), `${HOME}/Stash`);

// A registry with an empty vaults map: fallback too — there is no vault to
// nest a stash folder inside.
assert.strictEqual(suggestVaultPath({ vaults: {} }, HOME), `${HOME}/Stash`);

// Malformed shapes never throw, they fall back: not an object, vaults not a
// map, a vault entry without a string path.
assert.strictEqual(suggestVaultPath("junk", HOME), `${HOME}/Stash`);
assert.strictEqual(suggestVaultPath({ vaults: "junk" }, HOME), `${HOME}/Stash`);
assert.strictEqual(
  suggestVaultPath({ vaults: { a: { path: 42, open: true } } }, HOME),
  `${HOME}/Stash`
);

// One vault: suggest a stash/ folder inside it, open flag or not.
assert.strictEqual(
  suggestVaultPath({ vaults: { a: { path: "/Users/demo/Vault", ts: 1 } } }, HOME),
  "/Users/demo/Vault/stash/"
);

// Multiple vaults: the one marked `open: true` wins, regardless of order.
assert.strictEqual(
  suggestVaultPath(
    {
      vaults: {
        a: { path: "/Users/demo/First", ts: 1 },
        b: { path: "/Users/demo/Current", ts: 2, open: true },
        c: { path: "/Users/demo/Third", ts: 3 },
      },
    },
    HOME
  ),
  "/Users/demo/Current/stash/"
);

// Multiple vaults, none marked open (Obsidian may omit the flag entirely):
// deterministic pick — the first entry with a usable path.
assert.strictEqual(
  suggestVaultPath(
    {
      vaults: {
        a: { path: "/Users/demo/First", ts: 1 },
        b: { path: "/Users/demo/Second", ts: 2 },
      },
    },
    HOME
  ),
  "/Users/demo/First/stash/"
);

console.log("obsidian-vaults demo: all assertions passed");
