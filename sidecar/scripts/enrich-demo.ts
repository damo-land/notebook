// Proof script for knowledge-note enrichment (T12).
//
// Seeds a temp vault with a `kind: knowledge` note containing a public URL
// plus two unrelated notes, runs the enrichment path over it, prints the
// resulting note and asserts the acceptance criteria:
//
//   * the original body bytes are still present verbatim (byte comparison
//     against the pre-enrichment body),
//   * an appended `## Context` section exists,
//   * `enriched` frontmatter is set,
//   * at most 3 `[[wiki-links]]`, all to notes that exist,
//   * the file still parses — with the TS parser AND with a mirror of the
//     Rust parser's rules (src-tauri/src/index.rs parse_note_file).
//
// It also proves the failure-safe and idempotence paths, which have no other
// mechanical proof on the sidecar side, plus two durability properties that
// only the stub can drive:
//
//   * a write landing on the note *during* the model call is not erased — the
//     compare-and-swap aborts instead, leaving no marker so the note is
//     retried — while an untouched note still enriches normally,
//   * a non-object JSON line on the real sidecar's stdin draws a structured
//     error instead of killing the process.
//
// Run (stubbed — no model call, no spend; this is the default):
//     npm --prefix sidecar run enrich:demo
// Run against the real LLM (one paid prompt, proves WebFetch/bookmark
// behaviour end to end):
//     npm --prefix sidecar run enrich:demo -- --real
//
// The stub path exists so this file's invariants — append-only, tag merging
// and sanitising, the link cap, the `enriched` marker — can be re-verified by
// anyone at any time without spending a prompt.
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  EnrichConflictError,
  MAX_LINKS,
  enrichNote,
  parseNoteFile,
  serializeNoteFile,
  type EnrichDeps,
  type RelatedNote,
} from "../src/enrich.ts";

const sidecarDir = fileURLToPath(new URL("..", import.meta.url));

const real = process.argv.includes("--real");

// A stub must never be able to masquerade as a real run. `npm run <script>
// --real` (and the same thing via an npm alias that forgets to pass `--`)
// silently swallows the flag as an npm config and exports it as
// `npm_config_real` instead of delivering it to argv. Without this guard the
// demo would run STUBBED while the reviewer believed they had exercised the
// live path — which is exactly the verification trap this file exists to
// avoid. If the flag was requested but did not arrive, fail loudly.
if (!real && process.env["npm_config_real"] !== undefined) {
  console.error(
    "FATAL: `--real` was requested but npm swallowed it as a config flag, so " +
      "this run would have been STUBBED while looking real.\n" +
      "Use one of:\n" +
      "  npm run sidecar:enrich:demo -- --real\n" +
      "  npm --prefix sidecar run enrich:demo -- --real\n" +
      "  npx tsx sidecar/scripts/enrich-demo.ts --real",
  );
  process.exit(1);
}

let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
    return;
  }
  console.log(`ok: ${msg}`);
}

// --- Rust parser mirror (src-tauri/src/index.rs parse_note_file) -------------
//
// The enriched file has to be readable by BOTH parsers. The Rust one is
// stricter than the TS one in a way that matters here: it splits each
// frontmatter line on the FIRST ':' and drops any key containing a space, so
// an ISO timestamp or a bare URL as a value must survive the split.

function parseLikeRust(text: string): { data: Record<string, string>; tags: string[]; body: string } {
  const data: Record<string, string> = {};
  let tags: string[] = [];
  if (!text.startsWith("---\n")) return { data, tags, body: text };
  const rest = text.slice(4);
  const end = rest.indexOf("\n---\n");
  if (end === -1) return { data, tags, body: text };
  for (const line of rest.slice(0, end).split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === "" || key.includes(" ")) continue;
    if (key === "tags") {
      tags = value
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
    } else {
      data[key] = value;
    }
  }
  return { data, tags, body: rest.slice(end + 5) };
}

// --- helpers -----------------------------------------------------------------

/** Body bytes as they sit in the file, i.e. everything after the `---` block. */
function bodyBytes(raw: Buffer): Buffer {
  const marker = raw.indexOf("\n---\n");
  return raw.subarray(marker + 5);
}

function countWikiLinks(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
}

function stubDeps(reply: string): EnrichDeps {
  return { runPrompt: async () => reply };
}

async function seedNote(
  vaultDir: string,
  name: string,
  frontmatter: string,
  body: string,
): Promise<string> {
  const path = join(vaultDir, name);
  await writeFile(path, `---\n${frontmatter}\n---\n${body}`, "utf8");
  return path;
}

// --- scenario 1: the acceptance criteria, end to end -------------------------

const PUBLIC_URL = "https://example.com";

async function scenarioMain(): Promise<void> {
  const vaultDir = await mkdtemp(join(tmpdir(), "notebook-enrich-demo-"));
  console.log(`\n=== scenario: knowledge note + public URL (${real ? "REAL LLM" : "stubbed"}) ===`);
  console.log("vault dir:", vaultDir);

  try {
    // The knowledge note under test: contains a public URL (bookmark case).
    const notePath = await seedNote(
      vaultDir,
      "20260828-090000-example-domain.md",
      "id: 20260828-090000-example-domain\ncreated: 2026-08-28T09:00:00.000Z\nkind: knowledge\ntags: [reference]",
      `Example Domain as a safe test target\n\nBookmarking ${PUBLIC_URL} — I keep needing a URL that is safe to\nhit from tests without hammering somebody's server.\n`,
    );
    // Two unrelated notes, which double as the link candidates.
    const groceriesPath = await seedNote(
      vaultDir,
      "20260828-100000-groceries.md",
      "id: 20260828-100000-groceries\ncreated: 2026-08-28T10:00:00.000Z\nkind: note\ntags: [home]",
      "Groceries\n\noat milk, rye bread\n",
    );
    const taxesPath = await seedNote(
      vaultDir,
      "20260828-110000-file-taxes.md",
      "id: 20260828-110000-file-taxes\ncreated: 2026-08-28T11:00:00.000Z\nkind: task\ntags: [admin]\ndeadline: 2026-09-15\ndone: false",
      "File taxes\n\nGather receipts first.\n",
    );

    const related: RelatedNote[] = [
      { id: "20260828-100000-groceries", title: "Groceries" },
      { id: "20260828-110000-file-taxes", title: "File taxes" },
    ];

    const rawBefore = await readFile(notePath);
    const bodyBefore = bodyBytes(rawBefore);
    const groceriesBefore = await readFile(groceriesPath);
    const taxesBefore = await readFile(taxesPath);

    // Every tool the model actually invoked. On the real run this is the only
    // evidence that separates a page that was FETCHED from one the model
    // recalls: the reply text alone cannot tell those apart.
    const toolUses: Array<{ name: string; input: unknown }> = [];

    // The stub deliberately misbehaves the way a model can: a tag containing a
    // comma (which would silently split into two tags) and a wiki-link to a
    // note that does not exist.
    const deps: EnrichDeps = real
      ? await (async () => {
          const { runPrompt } = await import("../src/llm.ts");
          return {
            runPrompt: (text: string, opts = {}) =>
              runPrompt(text, {
                ...opts,
                onToolUse: (name, input) => {
                  toolUses.push({ name, input });
                },
              }),
          } satisfies EnrichDeps;
        })()
      : stubDeps(
          "```json\n" +
            JSON.stringify({
              tags: ["web, bookmarks", "  #Test Fixtures ", "reference"],
              context:
                `${PUBLIC_URL} is IANA's reserved domain for documentation and examples. ` +
                "The page is a single paragraph explaining that the domain may be used in " +
                "literature without prior coordination.\n\n" +
                "Unrelated but nearby: [[20260828-100000-groceries]] and " +
                "[[20260828-110000-file-taxes]]. Also [[no-such-note]] and " +
                "[[another-fake-id|a fake with display text]].",
            }) +
            "\n```",
        );

    const result = await enrichNote({ vaultDir, path: notePath, related }, deps);
    console.log("\nenrichNote result:", JSON.stringify(result, null, 2));

    const rawAfter = await readFile(notePath);
    console.log("\n--- note after enrichment ---");
    console.log(rawAfter.toString("utf8"));
    console.log("--- end of note ---\n");

    assert(result.status === "enriched", "note was enriched");

    // (1) original user text bytes remain verbatim
    const bodyAfter = bodyBytes(rawAfter);
    assert(
      bodyAfter.length >= bodyBefore.length &&
        Buffer.compare(bodyAfter.subarray(0, bodyBefore.length), bodyBefore) === 0,
      "original body bytes are present verbatim as an exact byte prefix",
    );

    // (2) appended `## Context` section
    const appended = bodyAfter.subarray(bodyBefore.length).toString("utf8");
    assert(
      (bodyAfter.toString("utf8").match(/^## Context$/gm) ?? []).length === 1,
      "exactly one `## Context` heading",
    );
    assert(appended.includes("## Context"), "the `## Context` section is in the APPENDED bytes");
    assert(appended.trim().length > 40, "appended section has real content");

    // (3) enriched frontmatter is set
    const { fm } = parseNoteFile(rawAfter.toString("utf8"));
    const enriched = fm.data["enriched"];
    assert(typeof enriched === "string" && enriched !== "", "`enriched` frontmatter is set");
    assert(
      typeof enriched === "string" && !Number.isNaN(Date.parse(enriched)),
      `\`enriched\` parses as a date (${String(enriched)})`,
    );
    assert(fm.data["source"] === PUBLIC_URL, `\`source\` is the note's URL (${PUBLIC_URL})`);

    // frontmatter additions are limited to tags / source / enriched
    const before = parseNoteFile(rawBefore.toString("utf8")).fm.data;
    const addedKeys = Object.keys(fm.data).filter((k) => !(k in before));
    assert(
      addedKeys.every((k) => ["tags", "source", "enriched"].includes(k)),
      `only tags/source/enriched added (added: ${addedKeys.join(", ") || "none"})`,
    );
    const tagsAfter = Array.isArray(fm.data["tags"]) ? fm.data["tags"] : [];
    assert(
      tagsAfter[0] === "reference",
      `existing tag kept, in place (tags: [${tagsAfter.join(", ")}])`,
    );
    assert(tagsAfter.every((t) => !t.includes(",")), "no tag contains a comma");

    // (4) at most 3 wiki-links, all to notes that exist
    const links = countWikiLinks(bodyAfter.toString("utf8"));
    assert(links.length <= MAX_LINKS, `at most ${MAX_LINKS} wiki-links (found ${links.length})`);
    const candidateIds = related.map((r) => r.id);
    assert(
      links.every((l) => candidateIds.includes(l)),
      `every wiki-link targets an existing note (${JSON.stringify(links)})`,
    );

    // (5) the file still parses — TS parser and the Rust parser's rules
    assert(fm.data["id"] === "20260828-090000-example-domain", "TS parser: id round-trips");
    assert(fm.data["kind"] === "knowledge", "TS parser: kind round-trips");
    const rust = parseLikeRust(rawAfter.toString("utf8"));
    assert(rust.data["id"] === "20260828-090000-example-domain", "Rust parser: id round-trips");
    assert(rust.data["kind"] === "knowledge", "Rust parser: kind round-trips");
    assert(rust.data["created"] === "2026-08-28T09:00:00.000Z", "Rust parser: ISO created survives the first-colon split");
    assert(rust.data["source"] === PUBLIC_URL, "Rust parser: URL `source` survives the first-colon split");
    assert(rust.data["enriched"] === enriched, "Rust parser: `enriched` matches the TS parser");
    assert(rust.tags.join(",") === tagsAfter.join(","), "Rust parser: tags list matches the TS parser");
    assert(rust.body.includes("## Context"), "Rust parser: body carries the appended section");

    // nothing else in the vault was touched
    assert(
      Buffer.compare(await readFile(groceriesPath), groceriesBefore) === 0 &&
        Buffer.compare(await readFile(taxesPath), taxesBefore) === 0,
      "the other two notes are byte-identical",
    );

    if (real) {
      // Bookmark behaviour, proved in two halves.
      console.log("\ntool calls observed:", JSON.stringify(toolUses, null, 2));
      assert(result.fetchedUrls.includes(PUBLIC_URL), "the note's URL was offered to WebFetch");

      // (a) "enrichment fetches it (SDK web tools)" — the model really called
      //     WebFetch, and called it against THIS note's URL. Matching on the
      //     host rather than the exact string so a normalised or redirected
      //     form ("https://example.com/") still counts as a fetch.
      const fetches = toolUses.filter((t) => t.name === "WebFetch");
      assert(
        fetches.length > 0,
        `WebFetch was actually invoked (tools used: ${toolUses.map((t) => t.name).join(", ") || "none"})`,
      );
      const host = new URL(PUBLIC_URL).host;
      assert(
        fetches.some((t) => JSON.stringify(t.input ?? null).includes(host)),
        `WebFetch was invoked against ${host}`,
      );

      // (b) "the appended section summarises the target" — require several
      //     terms drawn from what the page actually says. The old check passed
      //     on "example"/"domain"/"document", which merely restating the URL
      //     satisfies; these are page content, and two of them together are
      //     not something a summary gets by accident.
      const lower = appended.toLowerCase();
      const pageTerms = ["illustrat", "literature", "prior coordination", "permission", "reserved", "iana"];
      const hits = pageTerms.filter((w) => lower.includes(w));
      assert(
        hits.length >= 2,
        `appended section summarises the fetched page (matched: ${JSON.stringify(hits)})`,
      );
    } else {
      // Stub-only: the deterministic guards, which a real reply cannot pin down.
      assert(links.length === 2, "stub: both real candidates linked");
      assert(
        !bodyAfter.toString("utf8").includes("[[no-such-note]]") &&
          !bodyAfter.toString("utf8").includes("[[another-fake-id"),
        "stub: hallucinated link targets were de-linked, not left dangling",
      );
      assert(
        appended.includes("no-such-note") && appended.includes("a fake with display text"),
        "stub: de-linked targets survive as plain text (nothing silently dropped)",
      );
      assert(
        tagsAfter.join(",") === "reference,web-bookmarks,test-fixtures",
        `stub: tags merged + sanitised (got [${tagsAfter.join(", ")}])`,
      );
    }

    // --- idempotence: a second pass must not touch the note ---
    const beforeSecond = await readFile(notePath);
    const second = await enrichNote(
      { vaultDir, path: notePath, related },
      stubDeps('{"tags":["should-not-appear"],"context":"should not be appended"}'),
    );
    assert(second.status === "skipped", `second pass skips (${second.reason ?? ""})`);
    assert(
      Buffer.compare(await readFile(notePath), beforeSecond) === 0,
      "second pass left the file byte-identical",
    );
  } finally {
    await rm(vaultDir, { recursive: true, force: true });
  }
}

// --- scenario 2: the link cap actually clamps (stub only, no spend) ----------

async function scenarioLinkCap(): Promise<void> {
  const vaultDir = await mkdtemp(join(tmpdir(), "notebook-enrich-cap-"));
  console.log("\n=== scenario: wiki-link cap ===");
  try {
    const notePath = await seedNote(
      vaultDir,
      "20260828-120000-linking.md",
      "id: 20260828-120000-linking\ncreated: 2026-08-28T12:00:00.000Z\nkind: knowledge\ntags: []",
      "Linking notes together\n\nHow many links is too many?\n",
    );
    const related: RelatedNote[] = [1, 2, 3, 4, 5].map((n) => ({
      id: `candidate-${n}`,
      title: `Candidate ${n}`,
    }));
    for (const r of related) {
      await seedNote(
        vaultDir,
        `${r.id}.md`,
        `id: ${r.id}\ncreated: 2026-08-28T12:0${r.id.slice(-1)}:00.000Z\nkind: note\ntags: []`,
        `${r.title}\n`,
      );
    }

    const rawBefore = await readFile(notePath);
    const bodyBefore = bodyBytes(rawBefore);

    // Six links: four valid candidates plus two hallucinated ids.
    const result = await enrichNote(
      { vaultDir, path: notePath, related },
      stubDeps(
        JSON.stringify({
          tags: ["linking"],
          context:
            "See [[candidate-1]], [[candidate-2]], [[candidate-3]], [[candidate-4]], " +
            "[[ghost-note]] and [[phantom-note]].",
        }),
      ),
    );

    const rawAfter = await readFile(notePath);
    const bodyAfter = bodyBytes(rawAfter);
    const links = countWikiLinks(bodyAfter.toString("utf8"));
    console.log("links kept:", JSON.stringify(links));
    console.log("appended:", bodyAfter.subarray(bodyBefore.length).toString("utf8").trim());

    assert(result.status === "enriched", "cap scenario: note enriched");
    assert(links.length === MAX_LINKS, `exactly ${MAX_LINKS} links survive a 6-link reply`);
    assert(
      links.join(",") === "candidate-1,candidate-2,candidate-3",
      "the first 3 valid candidates are the ones kept",
    );
    assert(
      !rawAfter.toString("utf8").includes("[[ghost-note]]") &&
        !rawAfter.toString("utf8").includes("[[phantom-note]]"),
      "hallucinated targets never become links",
    );
    assert(
      Buffer.compare(bodyAfter.subarray(0, bodyBefore.length), bodyBefore) === 0,
      "cap scenario: original body bytes verbatim",
    );
  } finally {
    await rm(vaultDir, { recursive: true, force: true });
  }
}

// --- scenario 3: failure safety (stub only, no spend) ------------------------

async function scenarioFailureSafe(): Promise<void> {
  const vaultDir = await mkdtemp(join(tmpdir(), "notebook-enrich-fail-"));
  console.log("\n=== scenario: failure safety ===");
  try {
    const notePath = await seedNote(
      vaultDir,
      "20260828-130000-fragile.md",
      "id: 20260828-130000-fragile\ncreated: 2026-08-28T13:00:00.000Z\nkind: knowledge\ntags: [rust]",
      "Fragile note\n\nThis text must survive a failed enrichment untouched.\n",
    );
    const rawBefore = await readFile(notePath);

    // (a) the model call itself fails — e.g. sidecar unreachable, not authed
    const thrown = await enrichNote(
      { vaultDir, path: notePath, related: [] },
      { runPrompt: async () => { throw new Error("Not authenticated with Claude Code."); } },
    ).then(
      () => null,
      (err: Error) => err,
    );
    assert(thrown !== null, "a failing model call propagates as an error");
    assert(
      Buffer.compare(await readFile(notePath), rawBefore) === 0,
      "failed model call: note is byte-identical",
    );

    // (b) the model replies with something unusable
    const garbage = await enrichNote(
      { vaultDir, path: notePath, related: [] },
      stubDeps("I'm afraid I can't do that."),
    ).then(
      () => null,
      (err: Error) => err,
    );
    assert(garbage !== null, "an unparseable reply propagates as an error");
    assert(
      Buffer.compare(await readFile(notePath), rawBefore) === 0,
      "unusable reply: note is byte-identical",
    );

    // The crucial part: no marker was written, so the next app start retries.
    const { fm } = parseNoteFile((await readFile(notePath)).toString("utf8"));
    assert(fm.data["enriched"] === undefined, "no `enriched` marker after failure -> will retry");

    // And a note outside the vault is refused before any read/write.
    const escaped = await enrichNote(
      { vaultDir, path: "/etc/hosts" },
      stubDeps('{"tags":[],"context":"nope"}'),
    ).then(
      () => null,
      (err: Error) => err,
    );
    assert(
      escaped !== null && /not a note inside the vault/.test(escaped.message),
      "a path outside the vault is refused",
    );
  } finally {
    await rm(vaultDir, { recursive: true, force: true });
  }
}

// --- scenario 4: a concurrent write during the job (stub only, no spend) -----
//
// The defect this proves fixed: `enrichNote` reads the note, awaits a model
// call that can run for minutes, then writes from that stale copy. The alerts
// scheduler polls every 30s, so it can mark a note `alerted: true` inside that
// window — and the stale write would erase the marker, so the due-alerts query
// re-selects the note and the user gets the notification twice.
//
// The stub sits exactly where the model call sits, so a write from inside it
// is a write *during* the job. That is how the original defect was reproduced.

/** Every leftover in the vault dir that is neither a note nor a directory. */
async function strayFiles(vaultDir: string): Promise<string[]> {
  const entries = await readdir(vaultDir);
  return entries.filter((e) => !e.endsWith(".md"));
}

async function scenarioConcurrentWrite(): Promise<void> {
  const vaultDir = await mkdtemp(join(tmpdir(), "notebook-enrich-race-"));
  console.log("\n=== scenario: concurrent write during the job (compare-and-swap) ===");
  try {
    const notePath = await seedNote(
      vaultDir,
      "20260828-140000-race.md",
      "id: 20260828-140000-race\ncreated: 2026-08-28T14:00:00.000Z\nkind: knowledge\ntags: [alerts]\nalert: 2026-08-28T15:00:00.000Z",
      "Race note\n\nThe alerts scheduler can fire while enrichment is thinking.\n",
    );
    const REPLY = JSON.stringify({
      tags: ["scheduling"],
      context: "Background on why a background job must never write from a stale read.",
    });

    // --- (a) someone writes to the note mid-job: the write must NOT land ---

    // What the racing writer left on disk, captured for a byte comparison.
    const raced: string[] = [];
    const racingDeps: EnrichDeps = {
      runPrompt: async () => {
        // Exactly what the alerts scheduler does: add `alerted: true` to the
        // frontmatter and write the note back.
        const { fm, body } = parseNoteFile(await readFile(notePath, "utf8"));
        fm.data["alerted"] = true;
        const next = serializeNoteFile(fm, body);
        await writeFile(notePath, next, "utf8");
        raced.push(next);
        return REPLY;
      },
    };

    const conflict = await enrichNote({ vaultDir, path: notePath, related: [] }, racingDeps).then(
      () => null,
      (err: Error) => err,
    );
    const afterRace = await readFile(notePath, "utf8");
    console.log("\n--- note after the raced job ---");
    console.log(afterRace);
    console.log("--- end of note ---");

    // THE race proof. Pre-fix, the stale write erases this line.
    assert(
      afterRace.includes("alerted: true"),
      "the concurrent `alerted: true` write survives the enrichment job",
    );
    assert(
      raced.length === 1 && afterRace === raced[0],
      "the note is byte-identical to what the concurrent writer left (no partial merge)",
    );
    assert(
      parseNoteFile(afterRace).fm.data["enriched"] === undefined,
      "no `enriched` marker after an aborted write -> the next app start retries it",
    );
    assert(!afterRace.includes("## Context"), "nothing was appended on the abort path");
    assert((await strayFiles(vaultDir)).length === 0, "abort path leaves no temp file behind");

    // The abort is distinguishable from a job failure, so a caller can tell
    // "someone else touched the file" from "the job failed".
    assert(
      conflict instanceof EnrichConflictError,
      `the abort throws EnrichConflictError (got: ${conflict === null ? "no error at all" : conflict.constructor.name})`,
    );
    assert(
      conflict !== null && /^enrich conflict:/.test(conflict.message),
      `the wire-level error carries the \`enrich conflict:\` prefix (${conflict?.message ?? "none"})`,
    );
    const jobFailure = await enrichNote(
      { vaultDir, path: notePath, related: [] },
      { runPrompt: async () => { throw new Error("Not authenticated with Claude Code."); } },
    ).then(() => null, (err: Error) => err);
    assert(
      jobFailure !== null && !(jobFailure instanceof EnrichConflictError),
      "a model failure is NOT reported as a conflict (the two are distinguishable)",
    );

    // --- (b) nothing touches the note: enrichment still writes normally ---

    const beforeQuiet = await readFile(notePath, "utf8");
    const quiet = await enrichNote(
      { vaultDir, path: notePath, related: [] },
      stubDeps(REPLY),
    );
    const afterQuiet = await readFile(notePath, "utf8");
    assert(quiet.status === "enriched", "unchanged file: the retry enriches normally");
    assert(
      typeof parseNoteFile(afterQuiet).fm.data["enriched"] === "string",
      "unchanged file: the `enriched` marker is set (the fix does not disable enrichment)",
    );
    assert(afterQuiet.includes("## Context"), "unchanged file: the `## Context` section is appended");
    const bodyQuietBefore = bodyBytes(Buffer.from(beforeQuiet, "utf8"));
    const bodyQuietAfter = bodyBytes(Buffer.from(afterQuiet, "utf8"));
    assert(
      Buffer.compare(bodyQuietAfter.subarray(0, bodyQuietBefore.length), bodyQuietBefore) === 0,
      "unchanged file: the original body bytes are still a verbatim prefix",
    );
    assert(
      afterQuiet.includes("alerted: true"),
      "unchanged file: the earlier `alerted: true` line is carried through the write",
    );
    assert((await strayFiles(vaultDir)).length === 0, "success path leaves no temp file behind");
  } finally {
    await rm(vaultDir, { recursive: true, force: true });
  }
}

// --- scenario 5: non-object stdin payloads (stub only, no spend) -------------

/**
 * Spawns the real stdio server and feeds it the three JSON payloads that parse
 * but are not request objects. `JSON.parse("null")` succeeds, and a guard that
 * reads `.id` off the result throws inside the line handler and takes the whole
 * process down — one malformed line would end every in-flight job. Each must
 * draw a structured error instead, and `ping` must still work afterwards.
 */
async function scenarioStdinGuard(): Promise<void> {
  console.log("\n=== scenario: non-object stdin payloads do not kill the sidecar ===");
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: sidecarDir,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const lines: string[] = [];
  let exited = false;
  const rl = createInterface({ input: child.stdout, terminal: false });
  const settled = new Promise<void>((resolve) => {
    rl.on("line", (line) => {
      lines.push(line);
      if (lines.length >= 4) resolve();
    });
    // A crash resolves too, so this scenario fails fast instead of hanging.
    child.on("exit", () => {
      exited = true;
      resolve();
    });
  });
  try {
    const bad = ["null", "[1, 2, 3]", '"just a string"'];
    for (const payload of bad) child.stdin.write(`${payload}\n`);
    child.stdin.write(`${JSON.stringify({ id: 7, method: "ping" })}\n`);
    await Promise.race([
      settled,
      new Promise<void>((resolve) => setTimeout(resolve, 20_000)),
    ]);

    console.log("sidecar replies:", JSON.stringify(lines, null, 2));
    assert(!exited, "the sidecar survived three non-object payloads");
    const replies = lines.map(
      (l) => JSON.parse(l) as { id: unknown; ok?: boolean; error?: string; result?: unknown },
    );
    bad.forEach((payload, i) => {
      const reply = replies[i];
      assert(
        reply !== undefined && reply.ok === false && reply.id === null && typeof reply.error === "string",
        `\`${payload}\` draws a structured error response (${JSON.stringify(reply ?? null)})`,
      );
    });
    assert(
      replies.find((r) => r.id === 7)?.result === "pong",
      "a subsequent ping on the same process still returns pong",
    );
  } finally {
    rl.close();
    child.stdin.end();
    child.kill();
  }
}

// --- run ---------------------------------------------------------------------

await scenarioMain();
if (!real) {
  // Stubbed guards; skipped on the real run, which exists only to prove the
  // WebFetch/bookmark behaviour that a stub cannot.
  await scenarioLinkCap();
  await scenarioFailureSafe();
  await scenarioConcurrentWrite();
  await scenarioStdinGuard();
}

if (failures > 0) {
  console.error(`\nenrich-demo: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nenrich-demo: all assertions passed (${real ? "real LLM" : "stubbed"})`);
