// Port of the note model and createNote / updateNote from
// src/lib/vault/index.ts. Pure: callers do the file I/O and pass in the
// directory listing, the clock and the time zone.

import Foundation

public enum NoteKind: String, CaseIterable, Sendable {
    case note, knowledge, task
}

public struct Note: Identifiable, Equatable, Sendable {
    /// Frontmatter `id`, falling back to the file name minus `.md`.
    public let id: String
    public let fileName: String
    public var frontmatter: Frontmatter
    public var body: String

    public init(fileName: String, text: String) {
        let (fm, body) = NoteFormat.parse(text)
        self.fileName = fileName
        self.frontmatter = fm
        self.body = body
        let fmID = fm["id"]?.string ?? ""
        self.id = fmID.isEmpty ? String(fileName.dropLast(fileName.hasSuffix(".md") ? 3 : 0)) : fmID
    }

    public var kind: NoteKind {
        switch frontmatter["kind"]?.string {
        case "knowledge": .knowledge
        case "task": .task
        default: .note
        }
    }

    public var created: String { frontmatter["created"]?.string ?? "" }
    public var tags: [String] { frontmatter["tags"]?.list ?? [] }
    public var deadline: String? { frontmatter["deadline"]?.string }
    /// `nil` when absent or not a boolean — only `true` means done.
    public var done: Bool? { frontmatter["done"]?.bool }
    public var alert: String? { frontmatter["alert"]?.string }

    public var firstLine: String {
        String(body.unicodeScalars.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
            .first.map { String(String.UnicodeScalarView($0)) } ?? "")
    }

    /// First non-empty line with leading markdown heading/list markers
    /// stripped, for list rows and navigation titles.
    public var title: String {
        let line = body.split(whereSeparator: \.isNewline)
            .lazy.map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty } ?? ""
        let stripped = line.replacingOccurrences(of: #"^(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?)"#, with: "", options: .regularExpression)
        return stripped.isEmpty ? "Untitled" : stripped
    }

    /// The file contents as they would be written back.
    public var text: String { NoteFormat.serialize(frontmatter, body: body) }
}

public struct NewNote: Sendable {
    public var body: String
    public var kind: NoteKind = .note
    public var tags: [String] = []
    public var deadline: String?
    public var done: Bool?
    public var alert: String?

    public init(body: String, kind: NoteKind = .note, tags: [String] = [], deadline: String? = nil, done: Bool? = nil, alert: String? = nil) {
        self.body = body
        self.kind = kind
        self.tags = tags
        self.deadline = deadline
        self.done = done
        self.alert = alert
    }
}

public enum NoteFactory {
    /// `createNote`: id = local-time `YYYYMMDD-HHMMSS` + `-` + slug, with a
    /// `-2`, `-3`… suffix if `<id>.md` is already in `existing`.
    /// `created` is UTC with milliseconds (`Date.toISOString`).
    public static func create(
        _ input: NewNote,
        now: Date = Date(),
        timeZone: TimeZone = .current,
        existing: Set<String>
    ) -> (fileName: String, text: String) {
        let base = "\(timestampPrefix(now, timeZone: timeZone))-\(slugify(input.body))"
        var id = base
        var n = 2
        while existing.contains("\(id).md") {
            id = "\(base)-\(n)"
            n += 1
        }
        var fm = Frontmatter()
        fm["id"] = .string(id)
        fm["created"] = .string(isoString(now))
        fm["kind"] = .string(input.kind.rawValue)
        fm["tags"] = .list(input.tags)
        if let d = input.deadline { fm["deadline"] = .string(d) }
        if let d = input.done { fm["done"] = .bool(d) }
        if let a = input.alert { fm["alert"] = .string(a) }
        return ("\(id).md", NoteFormat.serialize(fm, body: input.body))
    }

    /// `updateNote`: applies `setFrontmatter` in order (nil deletes), then
    /// `replaceBody`, then `appendBody`. Existing body bytes are re-emitted
    /// verbatim unless replaced.
    public static func update(
        _ text: String,
        setFrontmatter: [(String, FrontmatterValue?)] = [],
        replaceBody: String? = nil,
        appendBody: String? = nil
    ) -> String {
        var (fm, body) = NoteFormat.parse(text)
        for (k, v) in setFrontmatter { fm[k] = v }
        if let r = replaceBody { body = r }
        if let a = appendBody { body += a }
        return NoteFormat.serialize(fm, body: body)
    }

    /// First line → lowercase → runs of non-`[a-z0-9]` to `-` → trim dashes →
    /// first 40 chars → trim trailing dashes → `note` if empty.
    /// Lowercasing is per scalar (as JS `toLowerCase`, minus final-sigma
    /// context, which only ever yields non-ASCII and so becomes `-` anyway).
    static func slugify(_ body: String) -> String {
        let firstLine = body.unicodeScalars.prefix { $0 != "\n" }
        var out: [Character] = []
        var inRun = false
        for scalar in firstLine {
            for lower in scalar.properties.lowercaseMapping.unicodeScalars {
                if ("a"..."z").contains(lower) || ("0"..."9").contains(lower) {
                    out.append(Character(lower))
                    inRun = false
                } else if !inRun {
                    out.append("-")
                    inRun = true
                }
            }
        }
        var slug = Substring(String(out))
        while slug.first == "-" { slug.removeFirst() }
        while slug.last == "-" { slug.removeLast() }
        slug = slug.prefix(40)
        while slug.last == "-" { slug.removeLast() }
        return slug.isEmpty ? "note" : String(slug)
    }

    static func timestampPrefix(_ d: Date, timeZone: TimeZone) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: d)
        return String(format: "%04d%02d%02d-%02d%02d%02d", c.year!, c.month!, c.day!, c.hour!, c.minute!, c.second!)
    }

    /// `Date.prototype.toISOString`: UTC, milliseconds truncated (JS dates
    /// have no sub-millisecond part).
    public static func isoString(_ d: Date) -> String {
        let ms = Int64((d.timeIntervalSince1970 * 1000).rounded(.down))
        let whole = Date(timeIntervalSince1970: Double(ms.floorDiv(1000)))
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: whole)
        return String(format: "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", c.year!, c.month!, c.day!, c.hour!, c.minute!, c.second!, Int(ms.floorMod(1000)))
    }
}

private extension Int64 {
    func floorDiv(_ m: Int64) -> Int64 { (self - floorMod(m)) / m }
    func floorMod(_ m: Int64) -> Int64 { ((self % m) + m) % m }
}
