// Date helpers shared by the app, the widget and their tests. Pure
// Foundation. `created` is the Mac's ISO-8601 UTC timestamp; deadlines are
// Gregorian `YYYY-MM-DD` in local time.

import Foundation

public enum Dates {
    // Format styles, not ISO8601DateFormatter: value types, safe to share
    // across the app, widget and background-refresh threads.
    private static let isoFractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let iso = Date.ISO8601FormatStyle()

    /// `2026-10-09T21:24:36.704Z` (the Mac's `toISOString`), or without
    /// milliseconds.
    public static func created(_ s: String) -> Date? {
        (try? isoFractional.parse(s)) ?? (try? iso.parse(s))
    }

    /// Deadlines are Gregorian `YYYY-MM-DD` in the file whatever calendar
    /// the phone is set to; local time zone, like the Mac.
    public static let gregorian: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        return cal
    }()

    /// `YYYY-MM-DD` deadline → local midnight.
    public static func deadline(_ s: String) -> Date? {
        let parts = s.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return gregorian.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    public static func deadlineString(_ d: Date) -> String {
        let c = gregorian.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// Days from `now`'s day to a deadline (negative = overdue). `now` is a
    /// parameter because widgets render future timeline entries ahead of
    /// time: a midnight entry must say "Overdue", not today's "Today".
    public static func daysUntil(_ date: Date, now: Date = .now) -> Int {
        Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: now), to: date).day ?? 0
    }

    /// "Today", "Tomorrow", "Friday", "3 Nov", "3 Nov 2027".
    public static func relativeDay(_ date: Date, now: Date = .now) -> String {
        switch daysUntil(date, now: now) {
        case 0: return "Today"
        case 1: return "Tomorrow"
        case -1: return "Yesterday"
        case 2...6: return date.formatted(.dateTime.weekday(.wide))
        default:
            let sameYear = Calendar.current.isDate(date, equalTo: now, toGranularity: .year)
            return sameYear ? date.formatted(.dateTime.day().month(.abbreviated)) : date.formatted(.dateTime.day().month(.abbreviated).year())
        }
    }
}
