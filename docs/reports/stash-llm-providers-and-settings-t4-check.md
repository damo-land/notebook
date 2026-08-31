# T4 check — Ollama enrichment + unified degradation

Branch: anchor/stash-llm-providers-and-settings-t4 (commits c8c48f1, 119a9d1, 73c1ada)
Verdicts: behavioral PASS / audit PASS. Flags below block auto-land.

## Flags

1. `STASH_OLLAMA_URL` env override: undocumented (zero .md hits), though it
   follows the existing STASH_MODEL convention. Asymmetry: `ollamaPrompt`
   honors it unconditionally in production while `probeOllama` always hits
   hardcoded localhost — with the var set, Settings' reachability line can
   diverge from where enrichment traffic actually goes. Suggested cheap fix
   at/after land: make `probeOllama` default through the same
   `ollamaBaseUrl()` helper (one line) — could ride T3 or T5's merge, or land
   as-is and note it (the var is a power-user escape hatch nobody sets by
   default).
2. Cosmetic: stale "T4 fills this in" comment above the (untouched)
   `ollamaChat` stub — T3 deletes the stub anyway.
3. Known overlap: provider.test.ts + ollama.ts touched by both T3 and T4 —
   expect freshness-merge conflict between the two at land; resolution must
   keep T4's prompt-path tests AND T3's chat tests.

## Evidence highlights

- Retry wraps ONLY the parse step; model call sits outside — unreachable/
  model-missing throw after exactly one attempt (calls===1 asserted).
- Three-way prefix match verified: TS error constants → wire err.message →
  lib.rs substring arms ("Ollama is not reachable" / "Ollama model missing"),
  one eprintln per job, no retry loop (dispatched-set intact).
- enrich.test.ts + llm.test.ts byte-identical to main; claude arm untouched;
  flag-off path proven single-call. provider.test.ts edits confined to the
  superseded prompt stub; chat-stub assertions survive.
- Network surface: one new fetch, POST <base>/api/chat. No manifest/lockfile/
  CI touches. Tests 27/27, typechecks clean, cargo green, worktree clean.
