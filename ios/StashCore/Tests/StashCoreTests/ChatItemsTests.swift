import Foundation
import Testing
@testable import StashCore

private func item(_ id: String, kind: String = "note", created: String = "2026-10-01T00:00:00.000Z", extra: String = "", body: String) -> Note {
    Note(fileName: "\(id).md", text: "---\nid: \(id)\ncreated: \(created)\nkind: \(kind)\ntags: []\n\(extra)---\n\(body)")
}

/// Shaped like the real vault that broke chat: done tasks whose titles start
/// with "Notes -" (the Mac app's old name) next to a couple of real notes.
private let vault = [
    item("20260830-221700-notes-display", kind: "task", created: "2026-08-30T00:00:00.000Z", extra: "done: true\n", body: "Notes - how do I display all the entries?"),
    item("20260830-221616-notes-delete", kind: "task", created: "2026-08-30T00:00:01.000Z", extra: "done: true\n", body: "Notes - there's no way to delete an entry"),
    item("20260925-184650-will", kind: "task", created: "2026-09-25T00:00:00.000Z", extra: "done: true\n", body: "Share sandboxed laptop rules with Will"),
    item("20261009-222436-triss", kind: "task", created: "2026-10-09T00:00:00.000Z", body: "talk to Triss about an agency"),
    item("20261010-090000-bank", kind: "task", created: "2026-10-10T00:00:00.000Z", extra: "deadline: 2026-10-16\n", body: "Call the bank"),
    item("20261011-090000-late", kind: "task", created: "2026-10-11T00:00:00.000Z", extra: "deadline: 2026-10-12\n", body: "Renew passport"),
    item("20261012-090000-far", kind: "task", created: "2026-10-12T00:00:00.000Z", extra: "deadline: 2026-12-01\n", body: "Book flights"),
    item("20261101-131940-kate", created: "2026-11-01T00:00:00.000Z", body: "Potential present for Kate: a flannel shirt"),
    item("20261019-140851-video", kind: "knowledge", created: "2026-10-19T00:00:00.000Z", body: "Great video about autism benefits\n\nNine positive traits."),
]

/// Thursday 15 October 2026, 9am.
private let today = Dates.gregorian.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 9))!

@Test func searchingForNotesListsNotesNotTasksTitledNotes() {
    let out = ChatItems.search(vault, query: "notes", now: today)
    #expect(out.hasPrefix("1 note:\n- Potential present for Kate"))
    #expect(!out.contains("display all"))
    #expect(!out.contains("delete an entry"))
}

@Test func searchSummarisesThenShowsOnlyGroupsWithResults() {
    #expect(ChatItems.search(vault, query: "will", now: today) == """
    Found 1 item for "will": 1 done task (finished).

    1 done task (finished):
    - Share sandboxed laptop rules with Will [[20260925-184650-will]]
    """)
    // Several groups: open tasks first, done tasks last.
    let out = ChatItems.search(vault, query: "kate shirt notes entries", now: today)
    #expect(out.hasPrefix("Found 1 item for \"kate shirt entries\": 1 note."))
}

@Test func taskWithOtherWordsMeansAnyTask() {
    // "is the sandboxed task done?" must find the done task, not filter to open ones.
    let out = ChatItems.search(vault, query: "sandboxed task", now: today)
    #expect(out.hasPrefix("Found 1 item for \"sandboxed\": 1 done task (finished)."))
}

@Test func searchWithAKindWordNarrowsToThatKind() {
    // "kate notes": the note, not every item mentioning kate.
    #expect(ChatItems.search(vault, query: "kate notes", now: today).contains("1 note:\n- Potential present for Kate"))
    // A kind word with nothing in that kind falls back to every kind.
    #expect(ChatItems.search(vault, query: "triss notes", now: today).contains("1 open task (still to do):\n- talk to Triss"))
    #expect(ChatItems.search(vault, query: "zebra", now: today) == "Nothing matches \"zebra\": no tasks, notes or knowledge items.")
}

@Test func openTasksAreBucketedByDeadline() {
    let out = ChatItems.list(vault, group: .openTasks, now: today)
    #expect(out == """
    4 open tasks (still to do):
    Overdue:
    - Renew passport, overdue, was due Monday 12 October [[20261011-090000-late]]
    Due in the next 7 days:
    - Call the bank, due tomorrow (Friday 16 October) [[20261010-090000-bank]]
    Due later:
    - Book flights, due Tuesday 1 December [[20261012-090000-far]]
    No deadline:
    - talk to Triss about an agency [[20261009-222436-triss]]
    """)
}

@Test func openTasksWithoutDeadlinesSayNothingIsDue() {
    let out = ChatItems.list([vault[3]], group: .openTasks, now: today)
    #expect(out.hasPrefix("Nothing is due: none of the 1 open task (still to do) has a deadline.\n"))
    let later = ChatItems.list([vault[3], vault[6]], group: .openTasks, now: today)
    #expect(later.hasPrefix("Nothing is overdue or due in the next 7 days.\n2 open tasks (still to do):\n"))
}

@Test func readFallsBackToTheClosestMatchForAnInventedID() {
    let out = ChatItems.read(vault, ref: "20261009-222436-sandboxed-laptop-rules", now: today)
    #expect(out.hasPrefix("No item has the id \"20261009-222436-sandboxed-laptop-rules\". Closest match:\nDone task (finished): Share sandboxed laptop rules with Will"))
    // What the model actually sent once: a description, not an id.
    #expect(ChatItems.read(vault, ref: "done task, finished sandboxed laptop, due 20261009", now: today)
        .contains("Closest match:\nDone task (finished): Share sandboxed laptop rules with Will"))
}

@Test func listGroupsNameTheirKind() {
    #expect(ChatItems.list(vault, group: .doneTasks, now: today).hasPrefix("3 done tasks (finished):\n- Share sandboxed"))
    #expect(ChatItems.list(vault, group: .notes, now: today).hasPrefix("1 note:\n"))
    #expect(ChatItems.list(vault, group: .knowledge, now: today)
        == "1 knowledge item:\n- Great video about autism benefits: Nine positive traits. [[20261019-140851-video]]")
    #expect(ChatItems.list([], group: .openTasks, now: today) == "No open tasks.")
    let all = ChatItems.list(vault, group: .everything, now: today)
    #expect(all.hasPrefix("stash has 4 open tasks (still to do), 3 done tasks (finished), 1 note and 1 knowledge item."))
    #expect(!all.contains("display all")) // done tasks are only counted
}

@Test func readSaysWhatKindFirst() {
    let out = ChatItems.read(vault, ref: "[[20260830-221700-notes-display]]", now: today)
    #expect(out.hasPrefix("Done task (finished): Notes - how do I display all the entries?\nCreated: 2026-08-30\nCite as: [[20260830-221700-notes-display]]"))
    #expect(ChatItems.read(vault, ref: "20261010-090000-bank", now: today).contains("Open task (still to do): Call the bank\nDue tomorrow (Friday 16 October)"))
    #expect(ChatItems.read(vault, ref: "nope", now: today) == "No item with id \"nope\". Use search to find ids.")
}

@Test func chatTextHasNoEmDashes() {
    let texts = [ChatItems.instructions(today: today), ChatItems.listDescription, ChatItems.searchDescription,
                 ChatItems.list(vault, group: .everything, now: today), ChatItems.search(vault, query: "will", now: today)]
    for t in texts { #expect(!t.contains("—")) }
}

@Test func searchMatchesWordStartsNotInsideWords() {
    let items = [
        item("20261011-181320-maap", kind: "task", body: "complain to maap about jersey"),
        item("20260929-123303-omp", kind: "task", extra: "done: true\n", body: "Try OMP or PI to build a sofware factory"),
        item("20261004-090000-agents", kind: "knowledge", body: "Agents and orchestration"),
    ]
    // "omp" is a word in one title and buried inside "complain" in the other.
    let out = ChatItems.search(items, query: "omp software factory", now: today)
    #expect(out.hasPrefix("Found 1 item for \"omp software factory\": 1 done task (finished)."))
    #expect(!out.contains("maap"))
    // Word starts still match: "agent" finds "Agents".
    #expect(ChatItems.search(items, query: "agent", now: today).contains("Agents and orchestration"))
}
