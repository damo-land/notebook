// Sidecar entry point: long-running process speaking line-delimited JSON over
// stdio. Request: {id, method, params?} -> Response: {id, ok, result|error}.
// v1 methods: ping (no LLM), prompt ({text} -> LLM response text),
// enrich ({vaultDir, path, related?} -> append-only pass over a knowledge note),
// chat ({vaultDir, text, session?, turn?} -> {text, session}).
//
// `chat` also writes UNSOLICITED lines while it works:
//   {type: "chunk", id, turn, text}
// one per streamed text delta. They are not responses — they carry no `ok`,
// they do not close the request, and the normal {id, ok, result} line still
// follows. A reader must therefore check `type` BEFORE looking `id` up in its
// pending-request map, or the first chunk closes the request early.
import { createInterface } from "node:readline";
import { chatDeps, chatTurn } from "./chat.ts";
import { enrichNote, type RelatedNote } from "./enrich.ts";
import { runPrompt } from "./llm.ts";

/** Tolerant coercion of the `related` payload sent by the Rust dispatcher. */
function toRelated(value: unknown): RelatedNote[] {
  if (!Array.isArray(value)) return [];
  const out: RelatedNote[] = [];
  for (const entry of value) {
    const r = entry as { id?: unknown; title?: unknown };
    if (typeof r?.id === "string" && r.id !== "") {
      out.push({ id: r.id, title: typeof r.title === "string" ? r.title : "" });
    }
  }
  return out;
}

interface Request {
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

function respond(
  id: number | string | null,
  body: { ok: true; result: unknown } | { ok: false; error: string },
): void {
  process.stdout.write(JSON.stringify({ id, ...body }) + "\n");
}

/** One streamed text delta. See the protocol note at the top of this file. */
function emitChunk(id: number | string, turn: string | null, text: string): void {
  process.stdout.write(JSON.stringify({ type: "chunk", id, turn, text }) + "\n");
}

async function handle(req: Request): Promise<void> {
  try {
    switch (req.method) {
      case "ping":
        respond(req.id, { ok: true, result: "pong" });
        break;
      case "prompt": {
        const text = req.params?.["text"];
        if (typeof text !== "string" || text.length === 0) {
          respond(req.id, { ok: false, error: "prompt requires params.text (non-empty string)" });
          break;
        }
        respond(req.id, { ok: true, result: await runPrompt(text) });
        break;
      }
      case "enrich": {
        const vaultDir = req.params?.["vaultDir"];
        const path = req.params?.["path"];
        if (typeof vaultDir !== "string" || vaultDir === "" || typeof path !== "string" || path === "") {
          respond(req.id, {
            ok: false,
            error: "enrich requires params.vaultDir and params.path (non-empty strings)",
          });
          break;
        }
        // Throws on any failure, which the catch below turns into ok:false —
        // the note file is left untouched and unmarked, so the app retries it.
        const result = await enrichNote(
          { vaultDir, path, related: toRelated(req.params?.["related"]) },
          { runPrompt },
        );
        respond(req.id, { ok: true, result });
        break;
      }
      case "chat": {
        const vaultDir = req.params?.["vaultDir"];
        const text = req.params?.["text"];
        if (typeof vaultDir !== "string" || vaultDir === "" || typeof text !== "string") {
          respond(req.id, {
            ok: false,
            error: "chat requires params.vaultDir and params.text (non-empty strings)",
          });
          break;
        }
        const session = req.params?.["session"];
        const turn = req.params?.["turn"];
        const turnId = typeof turn === "string" ? turn : null;
        const result = await chatTurn(
          {
            vaultDir,
            text,
            ...(typeof session === "string" && session !== "" ? { session } : {}),
          },
          chatDeps,
          { onText: (delta) => emitChunk(req.id, turnId, delta) },
        );
        respond(req.id, { ok: true, result });
        break;
      }
      default:
        respond(req.id, { ok: false, error: `unknown method: ${req.method}` });
    }
  } catch (err) {
    respond(req.id, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return;
  let req: Request;
  try {
    req = JSON.parse(trimmed) as Request;
  } catch {
    respond(null, { ok: false, error: "invalid JSON" });
    return;
  }
  if (req.id === undefined || typeof req.method !== "string") {
    respond(null, { ok: false, error: "request must have id and method" });
    return;
  }
  void handle(req);
});

// Exit when the parent closes our stdin (app quit).
rl.on("close", () => process.exit(0));

console.error("[sidecar] started");
