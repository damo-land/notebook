import Foundation
import Testing
@testable import StashCore

private func note(_ id: String, kind: String = "note", created: String = "2026-10-01T00:00:00.000Z", extra: String = "", body: String) -> Note {
    Note(fileName: "\(id).md", text: "---\nid: \(id)\ncreated: \(created)\nkind: \(kind)\ntags: []\n\(extra)---\n\(body)")
}

private let vault = [
    note("20261001-090000-german", kind: "task", extra: "deadline: 2026-10-16\n", body: "start german in duolingo"),
    note("20261002-090000-triss", kind: "task", created: "2026-10-02T00:00:00.000Z", body: "talk to Triss about an agency"),
    note("20261003-090000-done", kind: "task", extra: "done: true\n", body: "kill fiecon-lab on github"),
    note("20261004-090000-agents", kind: "knowledge", created: "2026-10-04T00:00:00.000Z",
         body: "Agent orchestration patterns\n\nFan-out works when subtasks are independent. " + String(repeating: "x", count: 300)),
]

/// A fixed "today" so day phrases are stable: Thursday 15 October 2026, 9am.
private let today = Dates.gregorian.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 9))!

@Test func searchLeadsWithTitleAndCitesLast() {
    let out = ChatTools.search(vault, query: "agency", now: today)
    #expect(out == "- talk to Triss about an agency (task, open, created 2026-10-02) [[20261002-090000-triss]]")
    let agents = ChatTools.search(vault, query: "fan-out", now: today)
    #expect(agents.hasPrefix("- Agent orchestration patterns (knowledge, created 2026-10-04): Fan-out works"))
    #expect(agents.hasSuffix("… [[20261004-090000-agents]]"))
    #expect(agents.count < 280) // snippet capped
}

@Test func searchFallsBackToAnyTerm() {
    // No note has both words; the one with "german" still comes back.
    #expect(ChatTools.search(vault, query: "german holidays", now: today).hasPrefix("- start german in duolingo"))
    #expect(ChatTools.search(vault, query: "zebra") == "No notes match \"zebra\".")
}

@Test func searchCapsResults() {
    let many = (0..<8).map { note(String(format: "20261001-0900%02d-n", $0), body: "same word") }
    let out = ChatTools.search(many, query: "word", limit: 5)
    #expect(out.split(separator: "\n").count == 6)
    #expect(out.hasSuffix("(3 more, refine the search)"))
}

@Test func readGivesTitleFirstAndCiteLine() {
    let byID = ChatTools.read(vault, ref: "[[20261001-090000-german]]", now: today)
    #expect(byID.hasPrefix("title: start german in duolingo\nkind: task\nstatus: open\ndeadline: due tomorrow ("))
    #expect(byID.contains("cite as: [[20261001-090000-german]]\n\nstart german in duolingo"))
    #expect(ChatTools.read(vault, ref: "Agent orchestration").hasPrefix("title: Agent orchestration patterns"))
    #expect(ChatTools.read(vault, ref: "20261004-090000-agents", maxChars: 20).hasSuffix("… (truncated)"))
    #expect(ChatTools.read(vault, ref: "nope").hasPrefix("No note with id"))
}

@Test func openTasksReadLikeSentences() {
    let out = ChatTools.openTasks(vault, now: today)
    let lines = out.split(separator: "\n").map(String.init)
    #expect(lines[0] == "2 open tasks:")
    #expect(lines[1].hasPrefix("- start german in duolingo, due tomorrow ("))
    #expect(lines[1].hasSuffix(") [[20261001-090000-german]]"))
    #expect(lines[2] == "- talk to Triss about an agency [[20261002-090000-triss]]")
    #expect(ChatTools.openTasks([]) == "No open tasks.")
}

@Test func duePhrases() {
    let at = { (d: Int) in Dates.deadlineString(Dates.gregorian.date(byAdding: .day, value: d, to: today)!) }
    #expect(ChatTools.duePhrase(at(0), now: today).hasPrefix("due today ("))
    #expect(ChatTools.duePhrase(at(1), now: today).hasPrefix("due tomorrow ("))
    #expect(ChatTools.duePhrase(at(-1), now: today).hasPrefix("overdue, was due "))
    #expect(ChatTools.duePhrase(at(5), now: today).hasPrefix("due Tuesday"))
    #expect(!ChatTools.duePhrase(at(5), now: today).contains("("))
}

@Test func toolOutputHasNoEmDashes() {
    let all = ChatTools.search(vault, query: "a", now: today) + ChatTools.openTasks(vault, now: today)
        + ChatTools.read(vault, ref: "20261004-090000-agents", now: today)
    #expect(!all.contains("\u{2014}") && !all.contains("\u{2013}"))
}

@Test func linkNoteIDsWrapsOnlyBareIDs() {
    #expect(ChatTools.linkNoteIDs("see 20261001-090000-german and [[20261002-090000-triss]].")
            == "see [[20261001-090000-german]] and [[20261002-090000-triss]].")
    #expect(ChatTools.linkNoteIDs("call 2026-10-01 at 9") == "call 2026-10-01 at 9")
}

// MARK: - Rendering the model's answers (cases taken from real on-device replies)

private let shopping = note("20261107-101500-food-shopping", kind: "task", extra: "deadline: 2026-11-08\n", body: "Food shopping")

@Test func answerThatIsOnlyACitationShowsTheTitle() {
    // The real model replied with nothing but "[[id]]"; that used to render as a lone "↗".
    #expect(NoteText.chatMarkdown("[[20261107-101500-food-shopping]]", notes: [shopping])
            == "[Food shopping](stash://note/20261107-101500-food-shopping)")
    // Same with a bare id it forgot to bracket.
    #expect(NoteText.chatMarkdown("20261107-101500-food-shopping", notes: [shopping])
            == "[Food shopping](stash://note/20261107-101500-food-shopping)")
}

@Test func citationAfterTheTitleIsCompact() {
    #expect(NoteText.chatMarkdown("Food shopping is due tomorrow [[20261107-101500-food-shopping]]", notes: [shopping])
            == "Food shopping is due tomorrow [↗](stash://note/20261107-101500-food-shopping)")
}

@Test func wordsInBracketsAreKept() {
    // The model sometimes puts the title (and more) inside the brackets.
    #expect(NoteText.chatMarkdown("[[Food shopping (due 2026-11-08)]]", notes: [shopping])
            == "[Food shopping (due 2026-11-08)](stash://note/20261107-101500-food-shopping)")
    // Brackets that match nothing stay as plain text instead of vanishing.
    #expect(NoteText.chatMarkdown("Try [[the dentist]] first", notes: [shopping]) == "Try the dentist first")
    #expect(NoteText.chatMarkdown("[[x|custom label]]", notes: [shopping]) == "custom label")
}

@Test func plainAnswersAndURLsPassThrough() {
    #expect(NoteText.chatMarkdown("Nothing is due this week.", notes: [shopping]) == "Nothing is due this week.")
    #expect(NoteText.chatMarkdown("See https://example.com/a.", notes: []) == "See <https://example.com/a>.")
    #expect(NoteText.chatMarkdown("open [[ but never closed", notes: [shopping]) == "open [[ but never closed")
}
