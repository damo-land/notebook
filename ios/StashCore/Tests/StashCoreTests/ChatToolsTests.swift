import Foundation
import Testing
@testable import StashCore

private func note(_ id: String, kind: String = "note", created: String = "2026-10-01T00:00:00.000Z", extra: String = "", body: String) -> Note {
    Note(fileName: "\(id).md", text: "---\nid: \(id)\ncreated: \(created)\nkind: \(kind)\ntags: []\n\(extra)---\n\(body)")
}

/// A fixed "today" so day phrases are stable: Thursday 15 October 2026, 9am.
private let today = Dates.gregorian.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 9))!

@Test func duePhrases() {
    let at = { (d: Int) in Dates.deadlineString(Dates.gregorian.date(byAdding: .day, value: d, to: today)!) }
    #expect(ChatTools.duePhrase(at(0), now: today).hasPrefix("due today ("))
    #expect(ChatTools.duePhrase(at(1), now: today).hasPrefix("due tomorrow ("))
    #expect(ChatTools.duePhrase(at(-1), now: today).hasPrefix("overdue, was due "))
    #expect(ChatTools.duePhrase(at(5), now: today).hasPrefix("due Tuesday"))
    #expect(!ChatTools.duePhrase(at(5), now: today).contains("("))
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
