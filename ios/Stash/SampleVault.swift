#if DEBUG
// Simulator-only: `-sampleVault` seeds a throwaway vault in Caches so the app
// can be run and screenshotted without iCloud or the folder picker.
//   xcrun simctl launch booted land.damo.stash.ios -sampleVault -screen notes

import Foundation
import StashCore

enum SampleVault {
    static func folderFromLaunchArguments() -> URL? {
        guard CommandLine.arguments.contains("-sampleVault") else { return nil }
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("sample-vault", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        seed(dir)
        return dir
    }

    /// The `-screen` launch argument: tasks | notes | knowledge | detail |
    /// capture | settings | chat (`-chatPrompt "…"` sends a first message).
    static var screen: String? { argument("-screen") }

    /// `-vaultPath <dir>`: point the simulator at a folder on the Mac (e.g.
    /// the real iCloud Drive vault) — the in-simulator picker can't reach Mac
    /// paths. Remembered, so relaunching from the home screen keeps it;
    /// choosing a folder in Settings clears it.
    static let debugVaultPathKey = "debugVaultPath"

    static func folderFromVaultPath() -> URL? {
        if let path = argument("-vaultPath") {
            UserDefaults.standard.set(path, forKey: debugVaultPathKey)
        }
        guard let path = UserDefaults.standard.string(forKey: debugVaultPathKey) else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    static func argument(_ name: String) -> String? {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    private static func seed(_ dir: URL) {
        let day: TimeInterval = 86_400
        let now = Date()
        let cal = Dates.gregorian
        func date(_ offset: Int) -> String {
            let d = cal.date(byAdding: .day, value: offset, to: now)!
            let c = cal.dateComponents([.year, .month, .day], from: d)
            return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
        }
        let items: [(NewNote, TimeInterval)] = [
            (NewNote(body: "talk to Triss about an agency", kind: .task, tags: ["work"], deadline: date(-1)), 9 * day),
            (NewNote(body: "Book train tickets for Berlin", kind: .task, tags: ["travel"], deadline: date(0)), 2 * day),
            (NewNote(body: "Start German in Duolingo", kind: .task, tags: ["learning"], deadline: date(5)), 6 * day),
            (NewNote(body: "Proposals as focus topic for Q4", kind: .task, tags: ["work"]), 4 * day),
            (NewNote(body: "Kill fiecon lab on GitHub", kind: .task, done: true), 12 * day),
            (NewNote(body: "Try omp or pi to build a software factory\n\nhttps://github.com/example/omp — agent orchestration", kind: .task, tags: ["ai"]), 3 * day),
            (NewNote(body: "Agent orchestration patterns\n\n**Fan-out / fan-in** works when subtasks are independent. Keep a *verifier* per branch.\n\nSee https://example.com/agents and [[sample-other]] for the earlier write-up.", kind: .knowledge, tags: ["ai", "agents"]), 1 * day),
            (NewNote(body: "Ideas for the commute\n\n- reread the agency notes\n- outline the Q4 proposal\n- learn 10 German words", kind: .note), 0.2 * day),
        ]
        var names: Set<String> = []
        for (input, ago) in items {
            let (name, text) = NoteFactory.create(input, now: now.addingTimeInterval(-ago), existing: names)
            names.insert(name)
            try? text.write(to: dir.appendingPathComponent(name), atomically: true, encoding: .utf8)
        }
        let other = NoteFactory.update(
            NoteFactory.create(NewNote(body: "Earlier write-up on agents", kind: .knowledge), now: now.addingTimeInterval(-20 * day), existing: names).text,
            setFrontmatter: [("id", .string("sample-other")), ("enriched", .string("2026-09-01T10:00:00Z"))]
        )
        try? other.write(to: dir.appendingPathComponent("sample-other.md"), atomically: true, encoding: .utf8)
    }
}
#endif
