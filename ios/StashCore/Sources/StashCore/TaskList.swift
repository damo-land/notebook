// Port of src/lib/task-list.ts, plus the notes-list ordering and search the
// phone needs (the Mac gets these from its SQLite index).

public enum TaskList {
    /// Filter value meaning "no category filter".
    public static let allCategories = "all"

    /// Open tasks: `done` absent or false. Only `done: true` hides a task.
    public static func open(_ notes: [Note]) -> [Note] {
        notes.filter { $0.kind == .task && $0.done != true }
    }

    /// Deadline ascending (ISO strings compare lexicographically); tasks
    /// without a deadline sort last, ordered by creation time among themselves.
    public static func sortByDeadline(_ tasks: [Note]) -> [Note] {
        tasks.enumerated().sorted { l, r in
            let (a, b) = (l.element, r.element)
            switch (a.deadline, b.deadline) {
            case let (da?, db?) where da != db: return jsLess(da, db)
            case (.some, nil): return true
            case (nil, .some): return false
            default:
                if a.created != b.created { return jsLess(a.created, b.created) }
                return l.offset < r.offset // Array.prototype.sort is stable
            }
        }.map(\.element)
    }

    /// `"all"` plus every tag present on the given tasks, sorted, deduped.
    public static func categories(of tasks: [Note]) -> [String] {
        let tags = Set(tasks.flatMap(\.tags))
        return [allCategories] + tags.sorted(by: jsLess)
    }

    /// Tasks visible under a category filter.
    public static func filter(_ tasks: [Note], category: String) -> [Note] {
        category == allCategories ? tasks : tasks.filter { $0.tags.contains(category) }
    }
}

public enum NoteList {
    /// Every note, newest first (by `created`, then file name).
    public static func newestFirst(_ notes: [Note]) -> [Note] {
        notes.sorted { a, b in
            if a.created != b.created { return jsLess(b.created, a.created) }
            return jsLess(b.fileName, a.fileName)
        }
    }

    /// Every whitespace-separated term must appear (case- and
    /// diacritic-insensitive) in the body, a tag, or the id.
    public static func search(_ notes: [Note], query: String) -> [Note] {
        let terms = query.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !terms.isEmpty else { return notes }
        return notes.filter { note in
            let hay = ([note.body, note.id] + note.tags).joined(separator: "\n")
            return terms.allSatisfy {
                hay.range(of: $0, options: [.caseInsensitive, .diacriticInsensitive]) != nil
            }
        }
    }
}

/// JS `<` on strings: UTF-16 code unit order (Swift's `<` is Unicode-aware).
func jsLess(_ a: String, _ b: String) -> Bool {
    a.utf16.lexicographicallyPrecedes(b.utf16)
}
