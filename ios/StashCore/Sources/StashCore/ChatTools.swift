// What the on-device chat model sees when it calls a tool. Mirrors the Mac's
// MCP server (sidecar/src/mcp.ts: search_notes, read_note, list_tasks) but
// every output is capped: Apple's on-device model has a ~4k-token window
// shared by instructions, tool schemas, the conversation and the answer.
// Note ids are written as `[[id]]` so the model can cite them in the same
// form, which the app renders as tappable links.

import Foundation

public enum ChatTools {
    /// Up to `limit` matches, newest first. All terms must match; if nothing
    /// does (the model often sends several words), fall back to notes ranked
    /// by how many terms they contain.
    public static func search(_ notes: [Note], query: String, limit: Int = 5) -> String {
        let terms = query.split(whereSeparator: \.isWhitespace).map(String.init)
        let ordered = NoteList.newestFirst(notes)
        var hits = NoteList.search(ordered, query: query)
        if hits.isEmpty, terms.count > 1 {
            let scored = ordered.map { note in
                (note, terms.filter { !NoteList.search([note], query: $0).isEmpty }.count)
            }
            hits = scored.filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }.map(\.0)
        }
        guard !hits.isEmpty else { return "No notes match \"\(query)\"." }
        let shown = hits.prefix(limit).map(line)
        let more = hits.count > limit ? "\n(\(hits.count - limit) more — refine the search)" : ""
        return shown.joined(separator: "\n") + more
    }

    /// One note in full, body truncated to `maxChars`. `ref` may be an id, a
    /// file name, or (as a last resort) words from the title.
    public static func read(_ notes: [Note], ref: String, maxChars: Int = 1200) -> String {
        let key = ref.trimmingCharacters(in: CharacterSet(charactersIn: "[] \n"))
        let note = notes.first { $0.id == key }
            ?? notes.first { $0.fileName == key || $0.fileName == "\(key).md" }
            ?? notes.first { $0.title.range(of: key, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
        guard let note else { return "No note with id \"\(ref)\". Use searchNotes to find ids." }
        var header = ["[[\(note.id)]]", "kind: \(note.kind.rawValue)"]
        if !note.created.isEmpty { header.append("created: \(String(note.created.prefix(10)))") }
        if !note.tags.isEmpty { header.append("tags: \(note.tags.joined(separator: ", "))") }
        if let d = note.deadline { header.append("deadline: \(d)") }
        if note.kind == .task { header.append(note.done == true ? "status: done" : "status: open") }
        let body = note.body.count > maxChars ? String(note.body.prefix(maxChars)) + "… (truncated)" : note.body
        return header.joined(separator: "\n") + "\n\n" + body
    }

    /// Open tasks in the Tasks-view order (deadline first).
    public static func openTasks(_ notes: [Note], limit: Int = 20) -> String {
        let tasks = TaskList.sortByDeadline(TaskList.open(notes))
        guard !tasks.isEmpty else { return "No open tasks." }
        let lines = tasks.prefix(limit).map { t -> String in
            var s = "[[\(t.id)]] \(t.title)"
            if let d = t.deadline { s += " (due \(d))" }
            if !t.tags.isEmpty { s += " #" + t.tags.joined(separator: " #") }
            return s
        }
        let more = tasks.count > limit ? "\n(\(tasks.count - limit) more)" : ""
        return "\(tasks.count) open task\(tasks.count == 1 ? "" : "s"):\n" + lines.joined(separator: "\n") + more
    }

    /// Wraps bare note ids (`20261009-222436-slug`) in `[[ ]]` so a citation
    /// the model forgot to bracket is still a link. Already-bracketed ids are
    /// left alone.
    public static func linkNoteIDs(_ text: String) -> String {
        let pattern = #"(?<!\[\[)\b(\d{8}-\d{6}(?:-[a-z0-9]+)*)\b(?!\]\])"#
        guard let re = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return re.stringByReplacingMatches(in: text, range: range, withTemplate: "[[$1]]")
    }

    private static func line(_ note: Note) -> String {
        var meta = [note.kind.rawValue]
        if !note.created.isEmpty { meta.append(String(note.created.prefix(10))) }
        if note.kind == .task { meta.append(note.done == true ? "done" : "open") }
        if let d = note.deadline { meta.append("due \(d)") }
        var s = "[[\(note.id)]] (\(meta.joined(separator: ", "))) \(note.title)"
        let rest = note.body.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.dropFirst()
            .joined(separator: " ")
        if !rest.isEmpty { s += " — " + (rest.count > 150 ? String(rest.prefix(150)) + "…" : rest) }
        return s
    }
}
