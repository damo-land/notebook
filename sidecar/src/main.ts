// Sidecar entry point: long-running process speaking line-delimited JSON over
// stdio. Request: {id, method, params?} -> Response: {id, ok, result|error}.
// v1 methods: ping (no LLM), prompt ({text} -> LLM response text).
import { createInterface } from "node:readline";
import { runPrompt } from "./llm.ts";

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
