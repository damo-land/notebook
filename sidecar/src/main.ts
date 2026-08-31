// Sidecar entry point: long-running process speaking line-delimited JSON over
// stdio. Request: {id, method, params?} -> Response: {id, ok, result|error}.
// v1 methods: ping (no LLM), prompt ({text} -> LLM response text),
// enrich ({vaultDir, path, related?} -> append-only pass over a knowledge note),
// chat ({vaultDir, text, session?, turn?} -> {text, session}),
// claudeStatus ({} -> {authenticated, detail}),
// ollamaStatus ({} -> {reachable, models}).
//
// prompt/enrich/chat additionally accept an optional `llm` param
// ({provider, model}, sent by the Rust side from a fresh read of
// ~/.config/stash/config.json) and resolve the call through the provider seam
// (provider.ts) — absent, it defaults to claude/claude-haiku-4-5.
//
// `chat` also writes UNSOLICITED lines while it works:
//   {type: "chunk", id, turn, text}
// one per streamed text delta. They are not responses — they carry no `ok`,
// they do not close the request, and the normal {id, ok, result} line still
// follows. A reader must therefore check `type` BEFORE looking `id` up in its
// pending-request map, or the first chunk closes the request early.
import { createInterface } from "node:readline";
import type { ChatHistoryTurn } from "./chat.ts";
import { enrichNote, type RelatedNote } from "./enrich.ts";
import { runPrompt } from "./llm.ts";
import { probeOllama } from "./ollama.ts";
import {
  coerceLlmConfig,
  providerChatTurn,
  providerRunPrompt,
  resolveClaudeModel,
} from "./provider.ts";

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

/**
 * Tolerant coercion of the `history` payload (the frontend transcript,
 * replayed for the ollama provider's conversation continuity). Anything not
 * shaped like a prior turn is dropped.
 */
function toHistory(value: unknown): ChatHistoryTurn[] {
  if (!Array.isArray(value)) return [];
  const out: ChatHistoryTurn[] = [];
  for (const entry of value) {
    const t = entry as { role?: unknown; content?: unknown };
    if ((t?.role === "user" || t?.role === "assistant") && typeof t.content === "string") {
      out.push({ role: t.role, content: t.content });
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
        const llm = coerceLlmConfig(req.params?.["llm"]);
        respond(req.id, { ok: true, result: await providerRunPrompt(llm)(text) });
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
        const llm = coerceLlmConfig(req.params?.["llm"]);
        const result = await enrichNote(
          { vaultDir, path, related: toRelated(req.params?.["related"]) },
          {
            runPrompt: providerRunPrompt(llm),
            // Local models flub the JSON-only instruction more often; give
            // them one more attempt. Claude keeps its single shot.
            retryMalformedReplyOnce: llm.provider === "ollama",
          },
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
        const history = toHistory(req.params?.["history"]);
        const result = await providerChatTurn(
          coerceLlmConfig(req.params?.["llm"]),
          {
            vaultDir,
            text,
            ...(typeof session === "string" && session !== "" ? { session } : {}),
            ...(history.length > 0 ? { history } : {}),
          },
          { onText: (delta) => emitChunk(req.id, turnId, delta) },
        );
        respond(req.id, { ok: true, result });
        break;
      }
      case "claudeStatus": {
        // Claude auth status, by reusing THE existing auth detection: a
        // minimal runPrompt whose failures pass through classifyLlmError
        // (llm.ts) — the same typed signal smoke.ts and the enrich worker
        // rely on. There is no cheaper credential check: the OAuth chain
        // lives in the CLI (keychain on macOS), so asking the SDK is the
        // only honest probe. Typed result, never a throw.
        const llm = coerceLlmConfig(req.params?.["llm"]);
        try {
          await runPrompt("Reply with exactly one word: ok", {
            model: resolveClaudeModel(undefined, llm.model),
          });
          respond(req.id, { ok: true, result: { authenticated: true, detail: null } });
        } catch (err) {
          respond(req.id, {
            ok: true,
            result: {
              authenticated: false,
              detail: err instanceof Error ? err.message : String(err),
            },
          });
        }
        break;
      }
      case "ollamaStatus": {
        // probeOllama never throws; a down daemon is {reachable: false}.
        respond(req.id, { ok: true, result: await probeOllama() });
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    respond(null, { ok: false, error: "invalid JSON" });
    return;
  }
  // `null`, `[...]` and `"str"` are all valid JSON, so they reach us parsed —
  // and reading `.id` off any of them (null especially) would throw inside the
  // line handler and take the process down. Reject non-objects first.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    respond(null, { ok: false, error: "request must be a JSON object" });
    return;
  }
  const req = parsed as Request;
  if (req.id === undefined || typeof req.method !== "string") {
    respond(null, { ok: false, error: "request must have id and method" });
    return;
  }
  void handle(req);
});

// Exit when the parent closes our stdin (app quit).
rl.on("close", () => process.exit(0));

console.error("[sidecar] started");
