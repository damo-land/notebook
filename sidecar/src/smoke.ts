// Smoke test: one trivial LLM prompt. Exits 0 with the response when authed;
// exits 1 with a setup-token hint when not.
import { NotAuthenticatedError, runPrompt } from "./llm.ts";

try {
  const reply = await runPrompt("Reply with exactly one word: pong");
  console.log(`sidecar smoke OK. Model replied: ${reply}`);
  process.exit(0);
} catch (err) {
  if (err instanceof NotAuthenticatedError) {
    console.error("Not authenticated. Run: claude setup-token");
    console.error(`(detail: ${err.message})`);
  } else {
    console.error(`sidecar smoke FAILED: ${err instanceof Error ? err.message : String(err)}`);
    console.error("If this looks auth-related, run: claude setup-token");
  }
  process.exit(1);
}
