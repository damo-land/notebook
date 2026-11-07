// Small text helpers for chat. The tools themselves (what the model is told
// and what each tool returns) live in ChatItems.swift.

import Foundation

public enum ChatTools {
    /// "due tomorrow (Sunday 8 November)", "overdue, was due Friday 6
    /// November", "due Thursday 12 November".
    public static func duePhrase(_ raw: String, now: Date = .now) -> String {
        guard let date = Dates.deadline(raw) else { return "due \(raw)" }
        let full = date.formatted(Date.FormatStyle(locale: Locale(identifier: "en_GB")).weekday(.wide).day().month(.wide))
        switch Dates.daysUntil(date, now: now) {
        case ..<0: return "overdue, was due \(full)"
        case 0: return "due today (\(full))"
        case 1: return "due tomorrow (\(full))"
        default: return "due \(full)"
        }
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
}
