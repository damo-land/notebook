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
        let toolOutput = lower.contains("due") || lower.contains("task") || lower.contains("todo")
            ? ChatTools.openTasks(store.notes, limit: 4)
            : ChatTools.search(store.notes, query: prompt, limit: 3)
        let answer = "**Simulator stand-in, not Apple's model.** This is the tool output the real model would read:\n\n" + toolOutput
        var shown = ""
        for word in answer.split(separator: " ", omittingEmptySubsequences: false) {
            shown += (shown.isEmpty ? "" : " ") + word
            partial(shown)
            try await Task.sleep(for: .milliseconds(25))
        }
        return answer
    }
}
#endif
