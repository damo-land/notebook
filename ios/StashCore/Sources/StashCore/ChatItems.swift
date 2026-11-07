// What the on-device chat model is told and what its tools return. The model
// is small (~3B, 4k-token window), so the work it is bad at happens here, in
// code: filtering by kind and status, grouping, counting, and sorting
// deadlines into overdue / this week / later. The model only picks a tool and
// phrases the answer.
//
// Every result names each item's kind in a heading ("2 notes:", "15 done
// tasks (finished):") rather than in a trailing parenthesis, because the model
// calls things whatever the nearest heading calls them. "Item" is the umbrella
// word; "note" only ever means the note kind. (The vault has done tasks titled
// "Notes - …" from when the Mac app was called Notes; a search for "notes"
// used to return those and the model listed them as notes.)
//
// The tool names, descriptions and instructions live here too, so the app's
// Foundation Models tools and the eval harness use the same text.

import Foundation

public enum ChatItems {
    /// The groups `list` can return. Raw values are the tool's enum values.
    public enum Group: String, CaseIterable, Sendable {
        case openTasks, doneTasks, notes, knowledge, everything
    }

    // MARK: Prompt and tool text

    public static func instructions(today: Date = .now) -> String {
        let day = today.formatted(Date.FormatStyle(locale: Locale(identifier: "en_GB")).weekday(.wide).day().month(.wide).year())
        return """
        You answer questions about the user's items in stash, a notes and tasks app. Today is \(day).
        stash has three kinds of items:
        - task: something to do. A task is open (still to do) or done (finished).
        - note: a thought, idea or link the user saved.
        - knowledge: something worth keeping, like an article or a video.
        A task is never a note, even when its title contains the word "notes".
        Always use a tool before answering:
        - list: what's due, what's on my plate, what I finished, my notes, my knowledge, or everything.
        - search: items about a topic or a person.
        - read: one item in full.
        Call each item what the heading above it in the tool result calls it: open task, done task, note or knowledge item.
        For what to do or what is due, mention only open tasks.
        Answer in one to three short, plain sentences. Name items by their title, in words, and give the deadline if there is one. \
        You may add the id in double brackets after a title, like "Call the bank, due tomorrow [[20261009-222436-call-the-bank]]". \
        Never reply with only ids or brackets. No preamble. If nothing matches, say so.
        """
    }

    public static let listName = "list"
    public static let listDescription = "List the user's items of one group: open tasks with deadlines, done tasks, notes, knowledge, or everything at a glance."
    public static let listArgument = "Which group to list"

    public static let searchName = "search"
    public static let searchDescription = "Find items about a topic or a person. Results are grouped into open tasks, notes, knowledge and done tasks."
    public static let searchArgument = "One to three keywords"

    public static let readName = "read"
    public static let readDescription = "Read one item in full by its id."
    public static let readArgument = "The item id, e.g. 20261009-222436-call-the-bank"

    // MARK: Tools

    public static func list(_ notes: [Note], group: Group, now: Date = .now) -> String {
        switch group {
        case .openTasks: return openTasks(notes, now: now)
        case .doneTasks: return section(.doneTasks, done(notes), limit: 10, now: now, emptyLine: "No done tasks.")
        case .notes: return section(.notes, newest(notes, .note), limit: 10, now: now, emptyLine: "No notes.")
        case .knowledge: return section(.knowledge, newest(notes, .knowledge), limit: 10, now: now, emptyLine: "No knowledge items.")
        case .everything: return overview(notes, now: now)
        }
    }

    /// Kind words in the query ("notes", "tasks", "knowledge") pick the group
    /// instead of being searched for: in a notes app "notes" is almost never
    /// meant literally. With only kind words left, this is `list`.
    public static func search(_ notes: [Note], query: String, now: Date = .now) -> String {
        var group: Group?
        var terms: [String] = []
        for raw in query.lowercased().split(whereSeparator: { $0.isWhitespace || $0 == "," }) {
            let word = String(raw)
            if let g = kindWords[word] { group = group ?? g } else if !stopWords.contains(word) { terms.append(word) }
        }
        if terms.isEmpty { return list(notes, group: group ?? .everything, now: now) }

        var hits = matches(notes, terms: terms)
        if let group, group != .everything {
            // "task" next to other words means any task, open or done: "is
            // the OMP task done?" must find the done one.
            let keep: (Note) -> Bool = group == .openTasks ? { $0.kind == .task } : { Self.group(of: $0) == group }
            let inGroup = hits.filter(keep)
            if !inGroup.isEmpty { hits = inGroup }
        }
        let q = terms.joined(separator: " ")
        guard !hits.isEmpty else { return "Nothing matches \"\(q)\": no tasks, notes or knowledge items." }

        // A summary line, then only the groups that have results: an empty
        // "Knowledge items: none" right above a group of done tasks led the
        // model to call those done tasks knowledge items.
        let groups = [Group.openTasks, .notes, .knowledge, .doneTasks]
            .map { g in (g, hits.filter { Self.group(of: $0) == g }) }
            .filter { !$0.1.isEmpty }
        let counts = groups.map { heading($0.0, count: $0.1.count) }.joined(separator: ", ")
        var parts = ["Found \(hits.count) item\(hits.count == 1 ? "" : "s") for \"\(q)\": \(counts)."]
        parts += groups.map { section($0.0, $0.1, limit: 5, now: now, emptyLine: "") }
        return parts.joined(separator: "\n\n")
    }

    /// One item in full; the first line says what kind it is.
    public static func read(_ notes: [Note], ref: String, maxChars: Int = 1200, now: Date = .now) -> String {
        let key = ref.trimmingCharacters(in: CharacterSet(charactersIn: "[] \n"))
        let note = notes.first { $0.id == key }
            ?? notes.first { $0.fileName == key || $0.fileName == "\(key).md" }
            ?? notes.first { $0.title.range(of: key, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
        // The model sometimes invents an id from the words it remembers
        // ("20261009-222436-omp-software-factory"): fall back to the item
        // those words find, and say so.
        var closest: Note?
        if note == nil {
            let words = key.lowercased()
                .replacingOccurrences(of: #"^\d{8}-\d{6}-?"#, with: "", options: .regularExpression)
                .split(whereSeparator: { !($0.isLetter || $0.isNumber) }).map(String.init)
                .filter { $0.count > 1 && !$0.allSatisfy(\.isNumber) && !stopWords.contains($0) && kindWords[$0] == nil }
            if !words.isEmpty { closest = matches(notes, terms: words).first }
        }
        guard let note = note ?? closest else { return "No item with id \"\(ref)\". Use search to find ids." }
        var lines = ["\(kindLabel(note)): \(note.title)"]
        if closest != nil { lines.insert("No item has the id \"\(ref)\". Closest match:", at: 0) }
        if let d = note.deadline { lines.append(ChatTools.duePhrase(d, now: now).capitalizedFirst) }
        if !note.tags.isEmpty { lines.append("Tags: \(note.tags.joined(separator: ", "))") }
        if !note.created.isEmpty { lines.append("Created: \(String(note.created.prefix(10)))") }
        lines.append("Cite as: [[\(note.id)]]")
        let body = note.body.count > maxChars ? String(note.body.prefix(maxChars)) + "… (truncated)" : note.body
        return lines.joined(separator: "\n") + "\n\n" + body
    }

    // MARK: Building blocks

    static func group(of note: Note) -> Group {
        switch note.kind {
        case .task: note.done == true ? .doneTasks : .openTasks
        case .note: .notes
        case .knowledge: .knowledge
        }
    }

    static func kindLabel(_ note: Note) -> String {
        switch group(of: note) {
        case .openTasks: "Open task (still to do)"
        case .doneTasks: "Done task (finished)"
        case .notes: "Note"
        default: "Knowledge item"
        }
    }

    static func heading(_ g: Group, count: Int) -> String {
        let one = count == 1
        switch g {
        case .openTasks: return "\(count) open task\(one ? "" : "s") (still to do)"
        case .doneTasks: return "\(count) done task\(one ? "" : "s") (finished)"
        case .notes: return "\(count) note\(one ? "" : "s")"
        case .knowledge, .everything: return "\(count) knowledge item\(one ? "" : "s")"
        }
    }

    private static func section(_ g: Group, _ items: [Note], limit: Int, now: Date, emptyLine: String) -> String {
        guard !items.isEmpty else { return emptyLine }
        var lines = ["\(heading(g, count: items.count)):"]
        lines += items.prefix(limit).map { line($0, now: now) }
        if items.count > limit { lines.append("(\(items.count - limit) more)") }
        return lines.joined(separator: "\n")
    }

    /// Open tasks split by deadline, so "what's due this week" needs no date
    /// arithmetic from the model.
    private static func openTasks(_ notes: [Note], now: Date) -> String {
        let tasks = TaskList.sortByDeadline(TaskList.open(notes))
        guard !tasks.isEmpty else { return "No open tasks." }
        var buckets: [(String, [Note])] = [("Overdue", []), ("Due in the next 7 days", []), ("Due later", []), ("No deadline", [])]
        for t in tasks {
            guard let raw = t.deadline, let d = Dates.deadline(raw) else { buckets[3].1.append(t); continue }
            switch Dates.daysUntil(d, now: now) {
            case ..<0: buckets[0].1.append(t)
            case 0...7: buckets[1].1.append(t)
            default: buckets[2].1.append(t)
            }
        }
        var parts = ["\(heading(.openTasks, count: tasks.count)):"]
        if buckets[3].1.count == tasks.count {
            // Said first and plainly: given only a list, the model reported
            // every task as "due this week".
            parts = ["Nothing is due: none of the \(heading(.openTasks, count: tasks.count)) has a deadline.",
                     "\(heading(.openTasks, count: tasks.count)), no deadlines:"]
            parts += tasks.prefix(20).map { line($0, now: now) }
        } else {
            if buckets[0].1.isEmpty, buckets[1].1.isEmpty { parts.insert("Nothing is overdue or due in the next 7 days.", at: 0) }
            for (title, items) in buckets {
                parts.append(items.isEmpty ? "\(title): none" : "\(title):")
                parts += items.map { line($0, now: now) }
            }
        }
        return parts.joined(separator: "\n")
    }

    private static func overview(_ notes: [Note], now: Date) -> String {
        let open = TaskList.open(notes).count, doneCount = done(notes).count
        let n = newest(notes, .note), k = newest(notes, .knowledge)
        var parts = ["stash has \(heading(.openTasks, count: open)), \(heading(.doneTasks, count: doneCount)), \(heading(.notes, count: n.count)) and \(heading(.knowledge, count: k.count))."]
        parts.append(openTasks(notes, now: now))
        parts.append(section(.notes, n, limit: 5, now: now, emptyLine: "No notes."))
        parts.append(section(.knowledge, k, limit: 5, now: now, emptyLine: "No knowledge items."))
        return parts.joined(separator: "\n\n")
    }

    private static func line(_ note: Note, now: Date) -> String {
        var s = "- \(note.title)"
        if note.kind == .task, note.done != true, let d = note.deadline { s += ", \(ChatTools.duePhrase(d, now: now))" }
        if !note.tags.isEmpty { s += " #" + note.tags.joined(separator: " #") }
        if note.kind != .task {
            let rest = note.body.split(whereSeparator: \.isNewline)
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.dropFirst()
                .joined(separator: " ")
            if !rest.isEmpty { s += ": " + (rest.count > 100 ? String(rest.prefix(100)) + "…" : rest) }
        }
        return s + " [[\(note.id)]]"
    }

    private static func done(_ notes: [Note]) -> [Note] {
        NoteList.newestFirst(notes.filter { $0.kind == .task && $0.done == true })
    }

    private static func newest(_ notes: [Note], _ kind: NoteKind) -> [Note] {
        NoteList.newestFirst(notes.filter { $0.kind == kind })
    }

    /// All terms match; failing that (the model often sends several words),
    /// items ranked by how many terms they contain. Terms match at the start
    /// of a word ("agent" finds "agents"), never inside one: "omp" must not
    /// find "complain".
    static func matches(_ notes: [Note], terms: [String]) -> [Note] {
        let ordered = NoteList.newestFirst(notes)
        let folded = terms.map(fold)
        let scored = ordered.map { note -> (Note, Int) in
            let hay = fold(([note.body, note.id] + note.tags).joined(separator: "\n"))
            return (note, folded.filter { startsWord(hay, $0) }.count)
        }
        let all = scored.filter { $0.1 == folded.count }.map(\.0)
        if !all.isEmpty || folded.count < 2 { return all }
        return scored.filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }.map(\.0)
    }

    private static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    }

    private static func startsWord(_ hay: String, _ term: String) -> Bool {
        var from = hay.startIndex
        while let r = hay.range(of: term, range: from..<hay.endIndex) {
            if r.lowerBound == hay.startIndex { return true }
            let before = hay[hay.index(before: r.lowerBound)]
            if !(before.isLetter || before.isNumber) { return true }
            from = hay.index(after: r.lowerBound)
        }
        return false
    }

    private static let kindWords: [String: Group] = [
        "note": .notes, "notes": .notes,
        "task": .openTasks, "tasks": .openTasks, "todo": .openTasks, "todos": .openTasks,
        "done": .doneTasks, "finished": .doneTasks, "completed": .doneTasks,
        "knowledge": .knowledge,
        "everything": .everything, "all": .everything, "items": .everything,
    ]
    private static let stopWords: Set<String> = ["about", "my", "the", "a", "an", "of", "for", "on", "with", "and"]
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
