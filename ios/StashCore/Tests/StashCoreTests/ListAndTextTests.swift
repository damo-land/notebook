import Foundation
import Testing
@testable import StashCore

private func note(_ name: String, kind: String = "task", created: String = "c", tags: String = "[]", extra: String = "", body: String = "b") -> Note {
    Note(fileName: "\(name).md", text: "---\nid: \(name)\ncreated: \(created)\nkind: \(kind)\ntags: \(tags)\n\(extra)---\n\(body)")
}

@Test func openTasksHidesOnlyDoneTrue() {
    let notes = [
        note("a"),
        note("b", extra: "done: true\n"),
        note("c", extra: "done: false\n"),
        note("d", extra: "done: yes\n"),
        note("e", kind: "note"),
    ]
    #expect(TaskList.open(notes).map(\.id) == ["a", "c", "d"])
}

@Test func sortByDeadlineMatchesTS() {
    let notes = [
        note("none-late", created: "2026-02"),
        note("d2", created: "2026-01", extra: "deadline: 2026-09-30\n"),
        note("none-early", created: "2026-01"),
        note("d1", created: "2026-05", extra: "deadline: 2026-09-26\n"),
        note("d1b", created: "2026-04", extra: "deadline: 2026-09-26\n"),
    ]
    #expect(TaskList.sortByDeadline(notes).map(\.id) == ["d1b", "d1", "d2", "none-early", "none-late"])
}

@Test func categories() {
    let notes = [note("a", tags: "[work, ai]"), note("b", tags: "[home, work]")]
    #expect(TaskList.categories(of: notes) == ["all", "ai", "home", "work"])
    #expect(TaskList.filter(notes, category: "home").map(\.id) == ["b"])
    #expect(TaskList.filter(notes, category: "all").count == 2)
}

@Test func newestFirstAndSearch() {
    let notes = [
        note("old", kind: "note", created: "2026-01-01T00:00:00.000Z", body: "Café notes"),
        note("new", kind: "note", created: "2026-02-01T00:00:00.000Z", tags: "[german]", body: "Start Duolingo"),
    ]
    #expect(NoteList.newestFirst(notes).map(\.id) == ["new", "old"])
    #expect(NoteList.search(notes, query: "cafe").map(\.id) == ["old"])
    #expect(NoteList.search(notes, query: "GERMAN start").map(\.id) == ["new"])
    #expect(NoteList.search(notes, query: "  ").count == 2)
}

@Test func titleStripsMarkers() {
    #expect(note("a", body: "\n\n## Heading\nmore").title == "Heading")
    #expect(note("a", body: "- [ ] buy milk").title == "buy milk")
    #expect(note("a", body: "").title == "Untitled")
    #expect(note("a", body: "first\nsecond").firstLine == "first")
}

@Test func idFallsBackToFileName() {
    #expect(Note(fileName: "loose.md", text: "no frontmatter").id == "loose")
}

@Test func renderableLinks() {
    let titles = ["20260101-000000-other": "Other note"]
    let out = NoteText.renderable("see [[20260101-000000-other]] and [[x|label]], https://a.b/c. and [y](https://keep.me) <https://also.kept>", titleFor: { titles[$0] })
    #expect(out == "see [Other note](stash://note/20260101-000000-other) and [label](stash://note/x), <https://a.b/c>. and [y](https://keep.me) <https://also.kept>")
    #expect(NoteText.noteID(from: URL(string: "stash://note/20260101-000000-other")!) == "20260101-000000-other")
    #expect(NoteText.noteID(from: URL(string: "https://a.b")!) == nil)
    #expect(NoteText.renderable("[[]] [[a\nb]] https://") == "[[]] [[a\nb]] https://")
}

@Test func renderedMarkdownParses() throws {
    let md = NoteText.renderable("**bold** then [[n1]]\nline two https://x.y/z")
    let attr = try AttributedString(markdown: md, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
    let links = attr.runs.compactMap(\.link)
    #expect(links.map(\.absoluteString) == ["stash://note/n1", "https://x.y/z"])
    #expect(String(attr.characters).contains("line two"))
}
