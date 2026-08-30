// Auth-failure detection (T9). Pure classification only — no model call, no
// SDK spawn: classifyLlmError is what runPrompt's catch runs every raw failure
// through, so proving it here proves the typed auth signal end to end.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_ERROR_PATTERN, classifyLlmError, NotAuthenticatedError } from "./llm.ts";

// The exact text SDK 0.3.250 returns when no OAuth credential is available
// (surfaced as a "success" result with is_error: true — see runPrompt).
const NOT_LOGGED_IN = "LLM call failed: Not logged in · Please run /login";

test("classifies the SDK's not-logged-in result as NotAuthenticatedError", () => {
  const err = classifyLlmError(new Error(NOT_LOGGED_IN));
  assert.ok(err instanceof NotAuthenticatedError);
  assert.equal(err.name, "NotAuthenticatedError");
});

test("classifies other credential-shaped failures", () => {
  for (const detail of [
    "Invalid API key · Fix external API key",
    "OAuth token expired",
    "credential chain is empty",
    "HTTP 401 from api.anthropic.com",
    "please run claude setup-token first",
  ]) {
    assert.ok(
      classifyLlmError(new Error(detail)) instanceof NotAuthenticatedError,
      `expected auth classification for: ${detail}`,
    );
  }
});

test("message keeps the stable prefix the app layers match on", () => {
  // src/components/chat-view.tsx and the Rust enrich worker both discriminate
  // on this prefix after main.ts flattens the error to its message.
  const err = classifyLlmError(new Error(NOT_LOGGED_IN));
  assert.match(err.message, /^Not authenticated with Claude Code\./);
  // The raw detail is preserved for the logs.
  assert.ok(err.message.includes("Not logged in"));
});

test("passes non-auth failures through unchanged", () => {
  for (const detail of [
    "LLM call failed (error_max_turns): ran out of turns",
    "fetch failed: ECONNREFUSED",
    "LLM call ended without a result message",
  ]) {
    const original = new Error(detail);
    const err = classifyLlmError(original);
    assert.equal(err, original, `expected passthrough for: ${detail}`);
    assert.ok(!(err instanceof NotAuthenticatedError));
  }
});

test("never double-wraps an already-typed auth error", () => {
  const original = new NotAuthenticatedError("token expired");
  assert.equal(classifyLlmError(original), original);
});

test("wraps non-Error throwables so callers always get an Error", () => {
  const auth = classifyLlmError("401 unauthorized");
  assert.ok(auth instanceof NotAuthenticatedError);
  const plain = classifyLlmError("something else broke");
  assert.ok(plain instanceof Error);
  assert.ok(!(plain instanceof NotAuthenticatedError));
});

test("AUTH_ERROR_PATTERN matches the documented credential-failure shapes", () => {
  assert.ok(AUTH_ERROR_PATTERN.test("Not logged in · Please run /login"));
  assert.ok(!AUTH_ERROR_PATTERN.test("no response within the chat timeout"));
});
