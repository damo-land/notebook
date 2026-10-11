// Port of src/lib/vault/frontmatter.ts — must stay byte-compatible with it.
//
// Minimal hand-rolled YAML-ish frontmatter: flat `key: value` pairs between
// `---` delimiter lines. Lists are inline `[a, b]`. Booleans are true/false.
// Unknown keys and non-matching lines pass through round-trip untouched —
// that is what keeps the Mac's `enriched:` / `alerted:` markers alive when the
// phone edits a note.
//
// The TS original runs on UTF-16 strings with JS regex/trim semantics; this
// port reproduces those semantics explicitly (JS `\s`, JS `trim`, `.` not
// matching line terminators) rather than leaning on Foundation's notion of
// whitespace, which differs at the edges (U+FEFF, U+0085).
// Verified against golden files written by scripts/ios-format-fixtures.ts.

public enum FrontmatterValue: Equatable, Hashable, Sendable {
    case string(String)
    case bool(Bool)
    case list([String])

    public var string: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    public var bool: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    public var list: [String]? {
        if case .list(let l) = self { return l }
        return nil
    }
}

public struct Frontmatter: Equatable, Sendable {
    public struct Entry: Equatable, Sendable {
        public var key: String
        public var value: FrontmatterValue
    }

    /// Keys in first-seen order (a JS object's insertion order).
    public private(set) var entries: [Entry] = []
    /// Lines inside the frontmatter block that are not `key: value` pairs.
    public var extraLines: [String] = []

    public init() {}

    public var keys: [String] { entries.map(\.key) }

    /// Get, or set like a JS object property: an existing key keeps its
    /// position, a new key is appended, and `nil` deletes.
    public subscript(key: String) -> FrontmatterValue? {
        get { entries.first { $0.key == key }?.value }
        set {
            let idx = entries.firstIndex { $0.key == key }
            switch (idx, newValue) {
            case let (i?, v?): entries[i].value = v
            case let (nil, v?): entries.append(Entry(key: key, value: v))
            case let (i?, nil): entries.remove(at: i)
            case (nil, nil): break
            }
        }
    }
}

public enum NoteFormat {
    /// Canonical key order for serialization; other keys follow in parse order.
    public static let keyOrder = ["id", "created", "kind", "tags", "deadline", "done", "alert"]

    /// Splits a note file into frontmatter and body. The body is returned
    /// exactly as it appears in the file (bytes verbatim after the closing
    /// `---` line).
    public static func parse(_ text: String) -> (frontmatter: Frontmatter, body: String) {
        var fm = Frontmatter()
        let bytes = Array(text.utf8)
        let open = Array("---\n".utf8)
        guard bytes.starts(with: open) else { return (fm, text) }
        // indexOf("\n---\n", 4). All-ASCII needle, so UTF-8 and UTF-16 offsets
        // land on the same boundaries.
        guard let end = find(Array("\n---\n".utf8), in: bytes, from: 4) else { return (fm, text) }
        let block = String(decoding: bytes[4..<end], as: UTF8.self)
        let body = String(decoding: bytes[(end + 5)...], as: UTF8.self)
        for line in jsSplit(block, on: "\n") {
            if let (key, raw) = matchKeyLine(Substring(line)) {
                fm[key] = parseValue(raw)
            } else {
                fm.extraLines.append(line)
            }
        }
        return (fm, body)
    }

    public static func serialize(_ fm: Frontmatter, body: String) -> String {
        let present = Set(fm.keys)
        let keys = keyOrder.filter { present.contains($0) } + fm.keys.filter { !keyOrder.contains($0) }
        var lines = keys.map { "\($0): \(serializeValue(fm[$0]!))" }
        lines.append(contentsOf: fm.extraLines)
        return "---\n\(lines.joined(separator: "\n"))\n---\n\(body)"
    }

    // MARK: - JS-semantics helpers

    /// `/^([A-Za-z_][A-Za-z0-9_-]*):\s?(.*)$/` with JS semantics: `.` excludes
    /// line terminators and `$` (no `m` flag) is end of input.
    static func matchKeyLine(_ line: Substring) -> (String, Substring)? {
        let scalars = line.unicodeScalars
        guard let first = scalars.first, isKeyStart(first) else { return nil }
        guard let colon = scalars.firstIndex(of: ":") else { return nil }
        let key = scalars[scalars.startIndex..<colon]
        guard key.dropFirst().allSatisfy(isKeyChar) else { return nil }
        let rest = scalars[scalars.index(after: colon)...]
        // `\s?` is greedy: try consuming one whitespace, then fall back to
        // consuming none. Either way the remainder must hold no terminator.
        if let ws = rest.first, isJSWhitespace(ws) {
            let value = rest.dropFirst()
            if !value.contains(where: isJSLineTerminator) {
                return (String(Substring(key)), Substring(value))
            }
        }
        if rest.contains(where: isJSLineTerminator) { return nil }
        return (String(Substring(key)), Substring(rest))
    }

    static func parseValue(_ raw: Substring) -> FrontmatterValue {
        let v = jsTrim(raw)
        if v == "true" { return .bool(true) }
        if v == "false" { return .bool(false) }
        // Scalar-level checks: Swift's Character-level hasPrefix/split would
        // treat `[` + combining mark (or `\r\n`) as one unit; JS does not.
        let us = v.unicodeScalars
        if us.first == "[" && us.last == "]" && us.count >= 2 {
            let inner = jsTrim(String(String.UnicodeScalarView(us.dropFirst().dropLast())))
            if inner.isEmpty { return .list([]) }
            return .list(jsSplit(inner, on: ",").map { jsTrim($0) })
        }
        return .string(v)
    }

    static func serializeValue(_ value: FrontmatterValue) -> String {
        switch value {
        case .list(let items): return "[\(items.joined(separator: ", "))]"
        case .bool(let b): return b ? "true" : "false"
        case .string(let s): return s
        }
    }

    /// `String.prototype.split(sep)` for a one-scalar separator.
    static func jsSplit(_ s: String, on sep: Unicode.Scalar) -> [String] {
        s.unicodeScalars
            .split(separator: sep, omittingEmptySubsequences: false)
            .map { String(String.UnicodeScalarView($0)) }
    }

    /// `String.prototype.trim`: strips JS WhiteSpace + LineTerminator.
    static func jsTrim<S: StringProtocol>(_ s: S) -> String {
        let scalars = Array(s.unicodeScalars)
        guard let lo = scalars.firstIndex(where: { !isJSWhitespace($0) }) else { return "" }
        let hi = scalars.lastIndex(where: { !isJSWhitespace($0) })!
        var out = String.UnicodeScalarView()
        out.append(contentsOf: scalars[lo...hi])
        return String(out)
    }

    /// JS regex `\s` (= the set `trim` strips).
    static func isJSWhitespace(_ c: Unicode.Scalar) -> Bool {
        switch c.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
            return true
        default:
            return false
        }
    }

    static func isJSLineTerminator(_ c: Unicode.Scalar) -> Bool {
        c.value == 0x0A || c.value == 0x0D || c.value == 0x2028 || c.value == 0x2029
    }

    private static func isKeyStart(_ c: Unicode.Scalar) -> Bool {
        ("A"..."Z").contains(c) || ("a"..."z").contains(c) || c == "_"
    }

    private static func isKeyChar(_ c: Unicode.Scalar) -> Bool {
        isKeyStart(c) || ("0"..."9").contains(c) || c == "-"
    }

    private static func find(_ needle: [UInt8], in hay: [UInt8], from start: Int) -> Int? {
        guard hay.count >= needle.count, start <= hay.count - needle.count else { return nil }
        for i in start...(hay.count - needle.count) where hay[i] == needle[0] {
            if hay[i..<(i + needle.count)].elementsEqual(needle) { return i }
        }
        return nil
    }
}
