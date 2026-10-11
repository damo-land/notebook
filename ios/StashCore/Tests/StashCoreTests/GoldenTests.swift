// Byte-compatibility with the TS vault library. golden.json is written by
// scripts/ios-format-fixtures.ts running the real TS code; these tests re-run
// the same inputs through the Swift port and demand identical bytes.

import Foundation
import Testing
@testable import StashCore

private struct Golden: Decodable {
    struct Create: Decodable {
        struct Input: Decodable {
            var body: String
            var kind: String?
            var tags: [String]?
            var deadline: String?
            var done: Bool?
            var alert: String?
        }
        var now: String
        var existing: [String]
        var input: Input
        var id: String
        var file: String
    }
    struct RoundTrip: Decodable {
        var input: String
        var output: String
        var body: String
        var keys: [String]
        var extraLines: [String]
    }
    struct Update: Decodable {
        struct Patch: Decodable {
            var setFrontmatter: [[JSONValue]]?
            var replaceBody: String?
            var appendBody: String?
        }
        var file: String
        var patch: Patch
        var output: String
    }
    var timeZone: String
    var create: [Create]
    var roundTrip: [RoundTrip]
    var update: [Update]
}

private enum JSONValue: Decodable {
    case string(String), bool(Bool), list([String]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else { self = .list(try c.decode([String].self)) }
    }

    var frontmatterValue: FrontmatterValue? {
        switch self {
        case .string(let s): .string(s)
        case .bool(let b): .bool(b)
        case .list(let l): .list(l)
        case .null: nil
        }
    }
}

private let golden: Golden = {
    let url = Bundle.module.url(forResource: "Fixtures/golden", withExtension: "json")!
    return try! JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
}()

private func parseISO(_ s: String) -> Date {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: s)!
}

@Test(arguments: golden.create.indices)
func createMatchesTS(_ i: Int) {
    let c = golden.create[i]
    let input = NewNote(
        body: c.input.body,
        kind: c.input.kind.flatMap(NoteKind.init(rawValue:)) ?? .note,
        tags: c.input.tags ?? [],
        deadline: c.input.deadline,
        done: c.input.done,
        alert: c.input.alert
    )
    let (fileName, text) = NoteFactory.create(
        input,
        now: parseISO(c.now),
        timeZone: TimeZone(identifier: golden.timeZone)!,
        existing: Set(c.existing)
    )
    #expect(fileName == "\(c.id).md")
    #expect(Array(text.utf8) == Array(c.file.utf8), "body: \(c.input.body.debugDescription)")
}

@Test(arguments: golden.roundTrip.indices)
func roundTripMatchesTS(_ i: Int) {
    let c = golden.roundTrip[i]
    let (fm, body) = NoteFormat.parse(c.input)
    #expect(Array(body.utf8) == Array(c.body.utf8))
    #expect(fm.keys == c.keys)
    #expect(fm.extraLines == c.extraLines)
    #expect(Array(NoteFormat.serialize(fm, body: body).utf8) == Array(c.output.utf8), "input: \(c.input.debugDescription)")
}

@Test(arguments: golden.update.indices)
func updateMatchesTS(_ i: Int) {
    let c = golden.update[i]
    let set: [(String, FrontmatterValue?)] = (c.patch.setFrontmatter ?? []).map { pair in
        guard case .string(let key) = pair[0] else { fatalError("bad key") }
        return (key, pair[1].frontmatterValue)
    }
    let out = NoteFactory.update(c.file, setFrontmatter: set, replaceBody: c.patch.replaceBody, appendBody: c.patch.appendBody)
    #expect(Array(out.utf8) == Array(c.output.utf8))
}

/// Opt-in: every file in a real vault survives parse → serialize unchanged.
/// Run with `STASH_VAULT_DIR=~/Notebook swift test`.
@Test func realVaultRoundTrip() throws {
    guard let dir = ProcessInfo.processInfo.environment["STASH_VAULT_DIR"] else { return }
    let url = URL(fileURLWithPath: (dir as NSString).expandingTildeInPath)
    let names = try FileManager.default.contentsOfDirectory(atPath: url.path).filter { $0.hasSuffix(".md") }
    #expect(!names.isEmpty)
    for name in names {
        let text = try String(contentsOf: url.appendingPathComponent(name), encoding: .utf8)
        let (fm, body) = NoteFormat.parse(text)
        #expect(NoteFormat.serialize(fm, body: body) == text, "\(name)")
    }
}
