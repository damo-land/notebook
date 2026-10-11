// Turns a note body into markdown that Foundation's inline-only parser renders
// with working links: `[[note-id]]` wiki-links become `stash://note/<id>`
// links, and bare http(s) URLs become autolinks. Same URL rules as
// src/lib/linkify.ts (runs to whitespace, trailing punctuation peeled off).

import Foundation

public enum NoteText {
    public static let noteLinkScheme = "stash"

    /// Note id from a `stash://note/<id>` URL produced by `renderable`.
    public static func noteID(from url: URL) -> String? {
        guard url.scheme == noteLinkScheme, url.host() == "note" else { return nil }
        let id = url.path().dropFirst() // leading "/"
        return id.isEmpty ? nil : String(id).removingPercentEncoding
    }

    public static func renderable(_ body: String, titleFor: (String) -> String? = { _ in nil }) -> String {
        var out = ""
        var rest = Substring(body)
        while !rest.isEmpty {
            if rest.hasPrefix("[["), let close = rest.range(of: "]]") {
                let inner = rest[rest.index(rest.startIndex, offsetBy: 2)..<close.lowerBound]
                if !inner.isEmpty, !inner.contains("\n"), !inner.contains("[") {
                    let parts = inner.split(separator: "|", maxSplits: 1)
                    let target = String(parts[0]).trimmingCharacters(in: .whitespaces)
                    let label = parts.count > 1 ? String(parts[1]) : (titleFor(target) ?? target)
                    let encoded = target.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? target
                    out += "[\(escapeLabel(label))](\(noteLinkScheme)://note/\(encoded))"
                    rest = rest[close.upperBound...]
                    continue
                }
            }
            if let url = bareURL(at: rest), !isInsideMarkdownLink(out) {
                out += "<\(url)>"
                rest = rest.dropFirst(url.count)
                continue
            }
            out.append(rest.removeFirst())
        }
        return out
    }

    private static let trailing: Set<Character> = [".", ",", ";", ":", "!", "?", ")", "]", "}", "`", "'", "\""]

    private static func bareURL(at s: Substring) -> String? {
        guard s.hasPrefix("https://") || s.hasPrefix("http://") else { return nil }
        var url = String(s.prefix { !$0.isWhitespace && $0 != "<" && $0 != ">" })
        while let last = url.last, trailing.contains(last) { url.removeLast() }
        let scheme = url.hasPrefix("https://") ? 8 : 7
        return url.count > scheme ? url : nil
    }

    /// Already-linked URLs (`[x](http…` or `<http…`) are left alone.
    private static func isInsideMarkdownLink(_ before: String) -> Bool {
        before.hasSuffix("](") || before.hasSuffix("<")
    }

    private static func escapeLabel(_ s: String) -> String {
        s.replacingOccurrences(of: "[", with: "\\[").replacingOccurrences(of: "]", with: "\\]")
    }
}
