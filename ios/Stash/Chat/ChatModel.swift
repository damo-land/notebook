// Chat over the vault. The model behind it is swappable: Apple's on-device
// Foundation Models on iOS 26+, or (Debug, `-fakeChat`) a canned responder
// so the UI can be exercised in a simulator that can't run the model.

import Foundation
import Observation
import StashCore

struct ChatMessage: Identifiable, Equatable {
    enum Role { case user, assistant, notice }
    let id = UUID()
    let role: Role
    var text: String
}

@MainActor
protocol ChatEngine: AnyObject {
    /// Why chat can't run right now, or nil when it can.
    var unavailableReason: String? { get }
    func prewarm()
    /// Forget the conversation (the next answer starts from scratch).
    func reset()
    /// Answers `prompt`, reporting the growing answer through `partial`.
    func respond(to prompt: String, partial: @escaping @MainActor (String) -> Void) async throws -> String
}

@Observable
@MainActor
final class ChatModel: Identifiable {
    private(set) var messages: [ChatMessage] = []
    private(set) var isResponding = false
    let engine: ChatEngine

    init(engine: ChatEngine) {
        self.engine = engine
    }

    static var isSupported: Bool {
        #if DEBUG
        if CommandLine.arguments.contains("-fakeChat") { return true }
        #endif
        if #available(iOS 26, *) { return true }
        return false
    }

    static func make(store: VaultStore) -> ChatModel? {
        #if DEBUG
        if CommandLine.arguments.contains("-fakeChat") { return ChatModel(engine: FakeChatEngine(store: store)) }
        #endif
        if #available(iOS 26, *) { return ChatModel(engine: AppleChatEngine(store: store)) }
        return nil
    }

    func send(_ text: String) async {
        let prompt = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, !isResponding else { return }
        messages.append(ChatMessage(role: .user, text: prompt))
        messages.append(ChatMessage(role: .assistant, text: ""))
        let index = messages.count - 1
        isResponding = true
        defer { isResponding = false }
        do {
            let answer = try await engine.respond(to: prompt) { [weak self] partial in
                self?.messages[index].text = partial
            }
            messages[index].text = answer
        } catch let notice as ChatNotice {
            messages.remove(at: index)
            messages.append(ChatMessage(role: .notice, text: notice.message))
        } catch {
            messages.remove(at: index)
            messages.append(ChatMessage(role: .notice, text: error.localizedDescription))
        }
    }

    func newChat() {
        messages = []
        engine.reset()
    }
}

/// An error that is really a message for the user (shown as a notice line).
struct ChatNotice: Error {
    let message: String
}

/// Instructions shared by every engine. Same intent as the Mac's
/// CHAT_SYSTEM_APPEND (sidecar/src/chat.ts): look before answering, cite
/// note ids, short plain answers, say when nothing matches.
enum ChatPrompt {
    static func instructions(today: Date = .now) -> String {
        """
        You answer questions about the user's personal notes: tasks, notes and knowledge, kept on this phone. \
        Today is \(today.formatted(.dateTime.weekday(.wide).day().month(.wide).year())).
        Use the tools before answering, never answer from memory: listOpenTasks for what's left to do, \
        searchNotes to find notes by keywords, readNote to read one in full.
        Cite every note you used by its id in double brackets, like [[20261009-222436-call-the-bank]].
        Keep answers short and plain, no preamble. If nothing matches, say so.
        """
    }
}
