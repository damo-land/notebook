#if DEBUG
// `-chatEval [runs]`: asks Apple's on-device model a fixed set of questions
// about the open vault with the shipping chat setup, each question in a
// fresh session. (Build 1's setup scored 7/12 on these; this one 21/24.)
// Every answer and tool call is printed as a JSON line (read it with
// `xcrun devicectl device process launch --console`) and saved to
// Documents/chat-eval.json. Only useful on a device: the simulator can't
// run the model unless the Mac itself runs macOS 26 or later.
//
// The questions match the Ollama harness (scratchpad chat-harness/run.py),
// which grades both outputs the same way.

import Foundation
import FoundationModels
import StashCore

@available(iOS 26, *)
@MainActor
enum ChatEval {
    static let questions = [
        "What notes do I have?",
        "What's on my plate?",
        "What's due this week?",
        "What have I finished recently?",
        "How many open tasks do I have?",
        "What did I save about Kate?",
        "Anything about autism?",
        "What do I have about Will?",
        "Is the OMP software factory task done?",
        "Show my knowledge",
        "What should I do next?",
        "What did I note about the notes app?",
    ]

    static func run(store: VaultStore, runs: Int) async {
        // Wait for the vault to load (and iCloud placeholders to download).
        for _ in 0..<120 where store.isLoading || store.notes.isEmpty || !store.pending.isEmpty {
            try? await Task.sleep(for: .seconds(1))
        }
        emit(["event": "start", "notes": store.notes.count, "pending": store.pending.count,
              "availability": "\(SystemLanguageModel.default.availability)"])
        var results: [[String: Any]] = []
        let url = URL.documentsDirectory.appending(path: "chat-eval.json")
        for variant in ["candidate"] {
            for question in questions {
                for run in 0..<runs {
                    let session = LanguageModelSession(
                        tools: [ListTool(store: store), SearchTool(store: store), ReadTool(store: store)],
                        instructions: ChatItems.instructions())
                    let start = Date()
                    var row: [String: Any] = ["variant": variant, "q": question, "run": run]
                    do {
                        row["answer"] = try await session.respond(to: question).content
                    } catch {
                        row["answer"] = "(error \(error))"
                    }
                    row["calls"] = toolCalls(session.transcript)
                    row["secs"] = (Date().timeIntervalSince(start) * 10).rounded() / 10
                    results.append(row)
                    emit(row)
                    // Saved after every answer: the phone locking or the
                    // console dropping must not lose what's done.
                    if let data = try? JSONSerialization.data(withJSONObject: results, options: .prettyPrinted) {
                        try? data.write(to: url, options: .atomic)
                    }
                }
            }
        }
        emit(["event": "done", "saved": url.path])
    }

    private static func toolCalls(_ transcript: Transcript) -> [String] {
        var out: [String] = []
        for entry in transcript {
            if case .toolCalls(let calls) = entry {
                for call in calls { out.append("\(call.toolName)(\(call.arguments.jsonString))") }
            }
        }
        return out
    }

    private static func emit(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let line = String(data: data, encoding: .utf8) else { return }
        print("CHAT_EVAL " + line)
        fflush(stdout)
    }
}
#endif
