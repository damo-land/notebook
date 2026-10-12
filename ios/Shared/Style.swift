// Shared by the app and the widget extension: palette, chip style, kind
// labels, date and meta-line formatting. No VaultStore here — the widget
// can't see it.

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

// MARK: - Meta lines

/// One line of row / header metadata, parts joined by " · ". Urgent parts
/// (overdue, due today) are set in primary semibold; the rest is secondary.
enum Meta {
    struct Part {
        let text: String
        var urgent = false
    }

    static func deadline(_ raw: String, now: Date = .now) -> Part {
        guard let date = Dates.deadline(raw) else { return Part(text: raw) }
        let days = Dates.daysUntil(date, now: now)
        if days < 0 { return Part(text: "Overdue · \(Dates.relativeDay(date, now: now))", urgent: true) }
        return Part(text: Dates.relativeDay(date, now: now), urgent: days == 0)
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

