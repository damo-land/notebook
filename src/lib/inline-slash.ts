// Pure logic for the inline "/" action menu (T2): query extraction between
// the typed "/" and the caret, prefix matching, and removal of the "/query"
// span when an action is applied. Kept out of App.tsx so the open/close rule
// is testable without a DOM (scripts/inline-slash-demo.ts).
//
// The rule: the menu opens when "/" is TYPED — a keydown. Pasting fires no
// keydown, so a pasted URL never opens it. The query is whatever sits
// between that "/" and the caret; whitespace in it, deleting the "/", or the
// caret leaving the span breaks the query (null → the menu closes), while a
// query that merely matches no action leaves the menu hidden and the text
// literal — backspacing to a match shows it again.

/** The query between an opening "/" at `pos` and the caret, lowercased for
 *  matching; null when the query is structurally broken (see above). */
export function inlineQuery(body: string, pos: number, caret: number): string | null {
  if (pos < 0 || caret <= pos || caret > body.length) return null;
  if (body[pos] !== "/") return null;
  const q = body.slice(pos + 1, caret);
  if (/\s/.test(q)) return null;
  return q.toLowerCase();
}

/** Actions whose label starts with the query ("" matches all). */
export function matchActions<T extends { label: string }>(actions: T[], query: string): T[] {
  return actions.filter((a) => a.label.startsWith(query));
}

/** The body with the "/query" span removed (an action was applied). */
export function removeQuery(body: string, pos: number, caret: number): string {
  return body.slice(0, pos) + body.slice(caret);
}
