// Pure splitter behind clickable links in the tasks view (T2, chat-polish).
//
// Splits a plain string into ordered text/url segments so the caller can
// render URL segments as clickable elements. Deliberately narrow (PoC, not
// RFC 3986):
//
//   * only `http://` and `https://` match — everything else stays text (the
//     Rust `open_external` command re-validates schemes anyway, this is just
//     the first gate);
//   * a URL runs until whitespace, then common trailing punctuation
//     (`.,;:!?)]}'"` and backtick) is peeled back off into the following text
//     segment — `https://a.b/c.` and `(see https://a.b)` keep their `.`/`)`
//     as prose, at the cost of mis-splitting the rare URL that genuinely ends
//     in one of those characters;
//   * a bare `https://` with nothing left after peeling is not a link.

export interface LinkifySegment {
  kind: "text" | "url";
  text: string;
}

const URL_RE = /https?:\/\/[^\s]+/g;

/** Characters peeled off the end of a match back into plain text. */
const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", "`", "'", '"']);

export function linkify(input: string): LinkifySegment[] {
  const segments: LinkifySegment[] = [];
  let cursor = 0;

  for (const match of input.matchAll(URL_RE)) {
    let url = match[0];
    while (url.length > 0 && TRAILING_PUNCTUATION.has(url[url.length - 1])) {
      url = url.slice(0, -1);
    }
    // Nothing beyond the scheme after peeling → not a real link.
    if (url === "http://" || url === "https://") continue;

    if (match.index > cursor) {
      segments.push({ kind: "text", text: input.slice(cursor, match.index) });
    }
    segments.push({ kind: "url", text: url });
    cursor = match.index + url.length;
  }

  if (cursor < input.length) {
    segments.push({ kind: "text", text: input.slice(cursor) });
  }
  return segments;
}
