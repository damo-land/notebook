// Demo/verification for the linkify helper (T2, chat-polish).
// Run: npx tsx scripts/linkify-demo.ts
//
// Proves the pure splitter (src/lib/linkify.ts) the tasks view uses to render
// clickable http(s) links in task titles:
//
//   * a bare URL becomes a single url segment;
//   * a URL mid-sentence keeps the surrounding text as text segments;
//   * a string with no URL comes back as one text segment (or none if empty);
//   * trailing punctuation (`.` `,` `)` etc.) is not swallowed into the URL;
//   * only http/https match — other schemes stay plain text.

import assert from "node:assert";
import { linkify } from "../src/lib/linkify";

// --- Bare URL: one url segment, nothing else. ---

assert.deepStrictEqual(linkify("https://example.com/a"), [
  { kind: "url", text: "https://example.com/a" },
]);
assert.deepStrictEqual(linkify("http://example.com"), [
  { kind: "url", text: "http://example.com" },
]);

// --- URL mid-sentence: text / url / text, order preserved. ---

assert.deepStrictEqual(linkify("see https://a.b/c for details"), [
  { kind: "text", text: "see " },
  { kind: "url", text: "https://a.b/c" },
  { kind: "text", text: " for details" },
]);

// --- Two URLs in one string. ---

assert.deepStrictEqual(linkify("x https://a.b and http://c.d y"), [
  { kind: "text", text: "x " },
  { kind: "url", text: "https://a.b" },
  { kind: "text", text: " and " },
  { kind: "url", text: "http://c.d" },
  { kind: "text", text: " y" },
]);

// --- No URL: the whole string is one text segment; empty in, empty out. ---

assert.deepStrictEqual(linkify("buy milk"), [{ kind: "text", text: "buy milk" }]);
assert.deepStrictEqual(linkify(""), []);

// --- Trailing punctuation stays text, not part of the URL. ---

assert.deepStrictEqual(linkify("https://a.b/c."), [
  { kind: "url", text: "https://a.b/c" },
  { kind: "text", text: "." },
]);
assert.deepStrictEqual(linkify("(see https://a.b)"), [
  { kind: "text", text: "(see " },
  { kind: "url", text: "https://a.b" },
  { kind: "text", text: ")" },
]);
assert.deepStrictEqual(linkify("read https://a.b/c?q=1, then reply"), [
  { kind: "text", text: "read " },
  { kind: "url", text: "https://a.b/c?q=1" },
  { kind: "text", text: ", then reply" },
]);

// --- Only http/https; other schemes are plain text. ---

assert.deepStrictEqual(linkify("ftp://a.b and file:///etc/hosts"), [
  { kind: "text", text: "ftp://a.b and file:///etc/hosts" },
]);
assert.deepStrictEqual(linkify("javascript://alert(1)"), [
  { kind: "text", text: "javascript://alert(1)" },
]);

// --- A bare scheme with nothing after `://` is not a link. ---

assert.deepStrictEqual(linkify("https:// is how URLs start"), [
  { kind: "text", text: "https:// is how URLs start" },
]);

console.log("linkify demo: all assertions passed");
