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

@Test func searchFormatsHitsNewestFirst() {
    let out = ChatTools.search(vault, query: "agency")
    #expect(out == "[[20261002-090000-triss]] (task, 2026-10-02, open) talk to Triss about an agency")
    let agents = ChatTools.search(vault, query: "fan-out")
    #expect(agents.hasPrefix("[[20261004-090000-agents]] (knowledge, 2026-10-04) Agent orchestration patterns — Fan-out works"))
    #expect(agents.hasSuffix("…"))
    #expect(agents.count < 260) // snippet capped
}

@Test func searchFallsBackToAnyTerm() {
    // No note has both words; the one with "german" still comes back.
    #expect(ChatTools.search(vault, query: "german holidays").hasPrefix("[[20261001-090000-german]]"))
    #expect(ChatTools.search(vault, query: "zebra") == "No notes match \"zebra\".")
}

@Test func searchCapsResults() {
    let many = (0..<8).map { note(String(format: "20261001-0900%02d-n", $0), body: "same word") }
    let out = ChatTools.search(many, query: "word", limit: 5)
    #expect(out.split(separator: "\n").count == 6)
    #expect(out.hasSuffix("(3 more — refine the search)"))
}

@Test func readResolvesIdBracketsAndTitle() {
    let byID = ChatTools.read(vault, ref: "[[20261001-090000-german]]")
    #expect(byID == "[[20261001-090000-german]]\nkind: task\ncreated: 2026-10-01\ndeadline: 2026-10-16\nstatus: open\n\nstart german in duolingo")
    #expect(ChatTools.read(vault, ref: "Agent orchestration").hasPrefix("[[20261004-090000-agents]]"))
    #expect(ChatTools.read(vault, ref: "20261004-090000-agents", maxChars: 20).hasSuffix("… (truncated)"))
    #expect(ChatTools.read(vault, ref: "nope").hasPrefix("No note with id"))
}

@Test func openTasksInDeadlineOrder() {
    #expect(ChatTools.openTasks(vault) == """
    2 open tasks:
    [[20261001-090000-german]] start german in duolingo (due 2026-10-16)
    [[20261002-090000-triss]] talk to Triss about an agency
    """)
    #expect(ChatTools.openTasks([]) == "No open tasks.")
}

@Test func linkNoteIDsWrapsOnlyBareIDs() {
    #expect(ChatTools.linkNoteIDs("see 20261001-090000-german and [[20261002-090000-triss]].")
            == "see [[20261001-090000-german]] and [[20261002-090000-triss]].")
    #expect(ChatTools.linkNoteIDs("call 2026-10-01 at 9") == "call 2026-10-01 at 9")
}
