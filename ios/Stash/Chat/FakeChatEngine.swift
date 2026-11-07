#if DEBUG
// `-fakeChat`: a canned responder for the simulator, which can't run Apple's
// model on this Mac. It calls the same StashCore tool builders the real
// model's tools use and streams the result word by word.

import Foundation
import StashCore

@MainActor
final class FakeChatEngine: ChatEngine {
    private let store: VaultStore

    init(store: VaultStore) {
        self.store = store
    }

    var unavailableReason: String? { nil }
    func prewarm() {}
    func reset() {}

    func respond(to prompt: String, partial: @escaping @MainActor (String) -> Void) async throws -> String {
        try await Task.sleep(for: .milliseconds(600)) // "thinking"
        let lower = prompt.lowercased()
        if lower.contains("error") {
            // Exercises the notice row the real engine uses for its errors.
            throw ChatNotice(message: "Apple's safety filter stopped that answer. Try rephrasing.")
        }
        let wantsTasks = lower.contains("due") || lower.contains("task") || lower.contains("todo")
        let answer: String
        if let canned = SampleVault.argument("-fakeReply") {
            // Replays a reply exactly as the real model gave it (to test rendering).
            answer = canned
        } else if CommandLine.arguments.contains("-demoAnswers") {
            // App Store screenshots: the kind of answer the real model gives,
            // built from the vault, without the stand-in banner.
            answer = wantsTasks ? dueThisWeek() : found(prompt)
        } else {
            let toolOutput = wantsTasks
                ? ChatItems.list(store.notes, group: .openTasks)
                : ChatItems.search(store.notes, query: prompt)
            answer = "**Simulator stand-in, not Apple's model.** This is the tool output the real model would read:\n\n" + toolOutput
        }
        var shown = ""
        for word in answer.split(separator: " ", omittingEmptySubsequences: false) {
            shown += (shown.isEmpty ? "" : " ") + word
            partial(shown)
            try await Task.sleep(for: .milliseconds(25))
        }
        return answer
    }

    private func dueThisWeek() -> String {
        let soon = TaskList.sortByDeadline(TaskList.open(store.notes)).filter { task in
            guard let raw = task.deadline, let date = Dates.deadline(raw) else { return false }
            return Dates.daysUntil(date) <= 7
        }
        guard !soon.isEmpty else { return "Nothing is due this week." }
        let counts = ["", "One thing", "Two things", "Three things", "Four things", "Five things"]
        let lines = soon.map { task -> String in
            let date = Dates.deadline(task.deadline!)!
            let days = Dates.daysUntil(date)
            let when = days < 0 ? "is overdue" : days == 0 ? "is due today" : "by \(Dates.relativeDay(date))"
            return "- **\(task.title)** \(when) [[\(task.id)]]"
        }
        let lead = soon.count < counts.count ? counts[soon.count] : "\(soon.count) things"
        return "\(lead) this week.\n\n" + lines.joined(separator: "\n") + "\n\nThe rest have no date."
    }

    private func found(_ prompt: String) -> String {
        let hits = NoteList.search(store.notes, query: prompt)
        guard !hits.isEmpty else { return "I couldn't find anything about that in your notes." }
        let lines = hits.prefix(3).map { "- **\($0.title)** [[\($0.id)]]" }
        return "From your notes:\n\n" + lines.joined(separator: "\n")
    }
}
#endif
