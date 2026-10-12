import Foundation
import Testing
@testable import StashCore

private func note(_ id: String, kind: String = "task", created: String, extra: String = "", tags: String = "[]", body: String? = nil) -> Note {
    Note(fileName: "\(id).md", text: "---\nid: \(id)\ncreated: \(created)\nkind: \(kind)\ntags: \(tags)\n\(extra)---\n\(body ?? id)")
}

private let vault = [
    note("old-nodue", created: "2026-01-01T00:00:00.000Z", tags: "[home]"),
    note("due-late", created: "2026-03-01T00:00:00.000Z", extra: "deadline: 2026-10-20\n", tags: "[work]"),
    note("due-soon", created: "2026-02-01T00:00:00.000Z", extra: "deadline: 2026-10-12\n", tags: "[work, ai]"),
    note("new-nodue", created: "2026-04-01T00:00:00.000Z"),
    note("done", created: "2026-05-01T00:00:00.000Z", extra: "done: true\n"),
    note("a-note", kind: "note", created: "2026-06-01T00:00:00.000Z"),
]

@Test func snapshotHoldsOpenTasksInTasksViewOrder() {
    let snap = WidgetSnapshot(notes: vault)
    #expect(snap.tasks.map(\.fileName) == TaskList.sortByDeadline(TaskList.open(vault)).map(\.fileName))
    #expect(snap.tasks.map(\.fileName) == ["due-soon.md", "due-late.md", "old-nodue.md", "new-nodue.md"])
    #expect(snap.tasks[0].deadline == "2026-10-12")
    #expect(snap.tasks[0].tags == ["work", "ai"])
    #expect(snap.tasks[0].title == "due-soon")
}

@Test func snapshotOrderAndCategory() {
    let snap = WidgetSnapshot(notes: vault)
    #expect(snap.tasks(order: .newest, category: nil).map(\.fileName) == ["new-nodue.md", "due-late.md", "due-soon.md", "old-nodue.md"])
    #expect(snap.tasks(order: .due, category: "work").map(\.fileName) == ["due-soon.md", "due-late.md"])
    #expect(snap.tasks(order: .newest, category: "work").map(\.fileName) == ["due-late.md", "due-soon.md"])
    #expect(snap.tasks(order: .due, category: "all").count == 4)
    #expect(snap.tasks(order: .due, category: "All").count == 4)
    #expect(snap.tasks(order: .due, category: "").count == 4)
    #expect(snap.tasks(order: .due, category: "gone").isEmpty)
    #expect(snap.categories == ["ai", "home", "work"])
}

@Test func snapshotIsCappedAndRoundTrips() throws {
    let many = (0..<120).map { note(String(format: "t%03d", $0), created: "2026-01-01T00:00:00.000Z") }
    #expect(WidgetSnapshot(notes: many).tasks.count == 100)

    let snap = WidgetSnapshot(notes: vault, generated: Date(timeIntervalSince1970: 1_791_000_000))
    #expect(try WidgetSnapshot.decode(snap.encoded()) == snap)
}

/// Widgets render future timeline entries ahead of time, so day labels must
/// come from the entry's date: a task due today reads "Today" now and is
/// overdue ("Yesterday") at the next midnight's entry.
@Test func dayLabelsFollowTheGivenNow() {
    let due = Dates.deadline("2026-10-12")!
    let morning = Dates.gregorian.date(from: DateComponents(year: 2026, month: 10, day: 12, hour: 9))!
    let nextMidnight = Dates.gregorian.date(from: DateComponents(year: 2026, month: 10, day: 13))!
    #expect(Dates.daysUntil(due, now: morning) == 0)
    #expect(Dates.relativeDay(due, now: morning) == "Today")
    #expect(Dates.daysUntil(due, now: nextMidnight) == -1)
    #expect(Dates.relativeDay(due, now: nextMidnight) == "Yesterday")
}

@Test func createdParsesBothISOForms() {
    #expect(Dates.created("2026-10-09T21:24:36.704Z") == Date(timeIntervalSince1970: 1_791_581_076.704))
    #expect(Dates.created("2026-10-09T21:24:36Z") == Date(timeIntervalSince1970: 1_791_581_076))
    #expect(Dates.created("not a date") == nil)
}
