import SwiftUI
import StashCore

// MARK: - Theme
//
// Black and white only, with two exceptions: the page background (a warm
// off-white in light mode, a soft charcoal in dark) and `accent`, which is
// reserved for the floating capture button and nothing else. Every other tone is black
// or white at an opacity (`Theme.surface`, the system `.secondary` /
// `.tertiary` text styles), so nothing on screen carries a hue. Emphasis
// comes from weight and contrast, never colour.

enum Theme {
    /// The one strong accent: the capture button. Same in light and dark.
    static let accent = Color(light: 0x2337FF, dark: 0x2337FF)
    /// Page background behind every screen and sheet.
    static let background = Color(light: 0xF7F7F5, dark: 0x141414)
    /// Fields, chips, bubbles: ink at low opacity over the background.
    static let surface = Color.primary.opacity(0.06)
    /// Grouped-form cells: white in light mode, a lifted charcoal in dark.
    static let cell = Color(light: 0xFFFFFF, dark: 0x1E1E1E)
    /// Filled controls (selected chip, primary button).
    static let ink = Color(light: 0x111111, dark: 0xF2F2F2)
    /// Text on `ink`.
    static let onInk = Color(light: 0xFFFFFF, dark: 0x111111)
    /// Swipe-action fill: black in light; a grey in dark, where the label
    /// stays white and black would vanish into the page.
    static let swipe = Color(light: 0x111111, dark: 0x4A4A4A)
    static let separator = Color.primary.opacity(0.08)
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}

extension View {
    /// A plain list on the page background, hairline separators.
    func themedList() -> some View {
        listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
    }

    /// A grouped form on the page background with white / charcoal cells.
    func themedForm() -> some View {
        scrollContentBackground(.hidden)
            .background(Theme.background)
    }

    /// Row chrome shared by every list row.
    func themedRow() -> some View {
        listRowBackground(Color.clear)
            .listRowSeparatorTint(Theme.separator)
    }
}

/// A capsule chip: filled ink when selected, a faint surface otherwise.
struct ChipStyle: ButtonStyle {
    var selected = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(selected ? .semibold : .regular))
            .foregroundStyle(selected ? Theme.onInk : Color.primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(selected ? Theme.ink : Theme.surface, in: .capsule)
            .opacity(configuration.isPressed ? 0.6 : 1)
            .contentShape(.capsule)
    }
}

// MARK: - Kinds

extension NoteKind {
    var label: String {
        switch self {
        case .note: "Note"
        case .knowledge: "Knowledge"
        case .task: "Task"
        }
    }

    var pluralLabel: String {
        switch self {
        case .note: "Notes"
        case .knowledge: "Knowledge"
        case .task: "Tasks"
        }
    }

    var symbol: String {
        switch self {
        case .note: "note.text"
        case .knowledge: "lightbulb"
        case .task: "checkmark.circle"
        }
    }
}

// MARK: - Dates

enum Dates {
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let iso = ISO8601DateFormatter()

    static func created(_ s: String) -> Date? {
        isoFractional.date(from: s) ?? iso.date(from: s)
    }

    /// Deadlines are Gregorian `YYYY-MM-DD` in the file whatever calendar
    /// the phone is set to; local time zone, like the Mac.
    static let gregorian: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        return cal
    }()

    /// `YYYY-MM-DD` deadline → local midnight.
    static func deadline(_ s: String) -> Date? {
        let parts = s.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return gregorian.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func deadlineString(_ d: Date) -> String {
        let c = gregorian.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// Days from today to a deadline (negative = overdue).
    static func daysUntil(_ date: Date) -> Int {
        Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: .now), to: date).day ?? 0
    }

    /// "Today", "Tomorrow", "Friday", "3 Nov", "3 Nov 2027".
    static func relativeDay(_ date: Date) -> String {
        switch daysUntil(date) {
        case 0: return "Today"
        case 1: return "Tomorrow"
        case -1: return "Yesterday"
        case 2...6: return date.formatted(.dateTime.weekday(.wide))
        default:
            let sameYear = Calendar.current.isDate(date, equalTo: .now, toGranularity: .year)
            return sameYear ? date.formatted(.dateTime.day().month(.abbreviated)) : date.formatted(.dateTime.day().month(.abbreviated).year())
        }
    }
}

// MARK: - Meta lines

/// One line of row / header metadata, parts joined by " · ". Urgent parts
/// (overdue, due today) are set in primary semibold; the rest is secondary.
enum Meta {
    struct Part {
        let text: String
        var urgent = false
    }

    static func deadline(_ raw: String) -> Part {
        guard let date = Dates.deadline(raw) else { return Part(text: raw) }
        let days = Dates.daysUntil(date)
        if days < 0 { return Part(text: "Overdue · \(Dates.relativeDay(date))", urgent: true) }
        return Part(text: Dates.relativeDay(date), urgent: days == 0)
    }

    static func tags(_ tags: [String]) -> Part? {
        tags.isEmpty ? nil : Part(text: tags.map { "#\($0)" }.joined(separator: " "))
    }

    static func text(_ parts: [Part?]) -> Text {
        let parts = parts.compactMap { $0 }
        var out = Text("")
        for (i, p) in parts.enumerated() {
            if i > 0 { out = out + Text("  ·  ").foregroundStyle(.tertiary) }
            out = out + Text(p.text)
                .fontWeight(p.urgent ? .semibold : .regular)
                .foregroundStyle(p.urgent ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
        }
        return out
    }
}

// MARK: - Shared bits

struct EmptyState: View {
    let title: String
    let symbol: String
    let message: String

    var body: some View {
        ContentUnavailableView(title, systemImage: symbol, description: Text(message))
            .foregroundStyle(.secondary)
    }
}

/// Banner shown while iCloud is still downloading notes.
struct PendingBanner: View {
    @Environment(VaultStore.self) private var store

    var body: some View {
        if !store.pending.isEmpty {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Downloading \(store.pending.count) note\(store.pending.count == 1 ? "" : "s") from iCloud…")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
    }
}

/// Small uppercase section label ("COMPLETED").
struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .tracking(0.6)
            .foregroundStyle(.secondary)
    }
}
