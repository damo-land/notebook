// Apple's on-device model (Foundation Models, iOS 26+, Apple Intelligence).
// Runs offline. Its context window is ~4k tokens shared by instructions, tool
// schemas, the whole conversation and the answer, so tool outputs are capped
// (StashCore.ChatTools) and an overflow starts a fresh session.

import Foundation
import FoundationModels
import StashCore

@available(iOS 26, *)
@MainActor
final class AppleChatEngine: ChatEngine {
    private let store: VaultStore
    private var session: LanguageModelSession

    init(store: VaultStore) {
        self.store = store
        self.session = Self.makeSession(store: store)
    }

    private static func makeSession(store: VaultStore) -> LanguageModelSession {
        LanguageModelSession(
            tools: [ListTool(store: store), SearchTool(store: store), ReadTool(store: store)],
            instructions: ChatPrompt.instructions()
        )
    }

    var unavailableReason: String? {
        switch SystemLanguageModel.default.availability {
        case .available:
            return nil
        case .unavailable(.deviceNotEligible):
            return "This iPhone can't run Apple's on-device model. Chat needs an iPhone 15 Pro or newer."
        case .unavailable(.appleIntelligenceNotEnabled):
            return "Turn on Apple Intelligence in Settings → Apple Intelligence & Siri, then come back."
        case .unavailable(.modelNotReady):
            return "Apple's on-device model is still downloading. Try again in a few minutes."
        case .unavailable:
            return "Apple's on-device model isn't available right now."
        }
    }

    func prewarm() {
        session.prewarm()
    }

    func reset() {
        session = Self.makeSession(store: store)
    }

    func respond(to prompt: String, partial: @escaping @MainActor (String) -> Void) async throws -> String {
        do {
            return try await stream(prompt, partial)
        } catch LanguageModelSession.GenerationError.exceededContextWindowSize {
            // The conversation outgrew the window: start over and retry once.
            reset()
            partial("")
            return try await stream(prompt, partial)
        } catch let error as LanguageModelSession.GenerationError {
            throw ChatNotice(message: Self.message(for: error))
        }
    }

    private func stream(_ prompt: String, _ partial: @escaping @MainActor (String) -> Void) async throws -> String {
        var latest = ""
        for try await snapshot in session.streamResponse(to: prompt) {
            latest = snapshot.content
            partial(latest)
        }
        return latest
    }

    private static func message(for error: LanguageModelSession.GenerationError) -> String {
        switch error {
        case .guardrailViolation, .refusal:
            return "Apple's safety filter stopped that answer. Try rephrasing."
        case .exceededContextWindowSize:
            return "That's too much for the on-device model in one go. Try a narrower question."
        case .assetsUnavailable:
            return "Apple's on-device model isn't ready yet. Try again in a few minutes."
        case .unsupportedLanguageOrLocale:
            return "The on-device model doesn't support this language yet."
        case .rateLimited, .concurrentRequests:
            return "The model is busy. Try again in a moment."
        default:
            return error.localizedDescription
        }
    }
}

// MARK: - Tools
// Names, descriptions and outputs come from StashCore.ChatItems, which the
// eval harness runs against a real vault with small local models.

@available(iOS 26, *)
struct ListTool: Tool {
    let store: VaultStore
    let name = ChatItems.listName
    let description = ChatItems.listDescription

    @Generable
    enum Group {
        case openTasks, doneTasks, notes, knowledge, everything
    }

    @Generable
    struct Arguments {
        @Guide(description: "Which group to list")
        var group: Group
    }

    func call(arguments: Arguments) async throws -> String {
        let group: ChatItems.Group = switch arguments.group {
        case .openTasks: .openTasks
        case .doneTasks: .doneTasks
        case .notes: .notes
        case .knowledge: .knowledge
        case .everything: .everything
        }
        return ChatItems.list(await store.notes, group: group)
    }
}

@available(iOS 26, *)
struct SearchTool: Tool {
    let store: VaultStore
    let name = ChatItems.searchName
    let description = ChatItems.searchDescription

    @Generable
    struct Arguments {
        @Guide(description: "One to three keywords")
        var query: String
    }

    func call(arguments: Arguments) async throws -> String {
        ChatItems.search(await store.notes, query: arguments.query)
    }
}

@available(iOS 26, *)
struct ReadTool: Tool {
    let store: VaultStore
    let name = ChatItems.readName
    let description = ChatItems.readDescription

    @Generable
    struct Arguments {
        @Guide(description: "The item id, e.g. 20261009-222436-call-the-bank")
        var id: String
    }

    func call(arguments: Arguments) async throws -> String {
        ChatItems.read(await store.notes, ref: arguments.id)
    }
}
