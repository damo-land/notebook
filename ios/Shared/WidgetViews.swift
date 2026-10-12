// The Tasks widget's views, small / medium / large. Shared with the app so a
// Debug gallery (`-screen widgets`) can render them for screenshots.
// Same language as the app: black and white on the page background, urgency
// by weight, the + in the accent colour. Day labels use the entry's date,
// not "now" — WidgetKit renders future entries (e.g. midnight) in advance.

import AppIntents
import SwiftUI
import WidgetKit
import StashCore

struct TasksWidgetEntry: TimelineEntry {
    let date: Date
    /// Tasks for this widget's settings, already filtered and ordered.
    let tasks: [WidgetSnapshot.Task]
    let category: String?
    /// False until the app has published its first snapshot.
    let hasData: Bool

    init(date: Date, snapshot: WidgetSnapshot?, order: WidgetSnapshot.Order, category: String?) {
        self.date = date
        self.category = WidgetSnapshot.isAllCategories(category) ? nil : category
        self.hasData = snapshot != nil
        self.tasks = snapshot?.tasks(order: order, category: category) ?? []
    }

    static func sample(date: Date = .now) -> TasksWidgetEntry {
        let today = Dates.deadlineString(date)
        let tomorrow = Dates.deadlineString(date.addingTimeInterval(86_400))
        let tasks = [
            WidgetSnapshot.Task(fileName: "a", title: "Talk to Triss about an agency", deadline: today, tags: ["work"], created: ""),
            WidgetSnapshot.Task(fileName: "b", title: "Book train tickets for Berlin", deadline: tomorrow, tags: ["travel"], created: ""),
            WidgetSnapshot.Task(fileName: "c", title: "Start German in Duolingo", deadline: nil, tags: [], created: ""),
            WidgetSnapshot.Task(fileName: "d", title: "Proposals as focus topic for Q4", deadline: nil, tags: ["work"], created: ""),
        ]
        return TasksWidgetEntry(date: date, snapshot: WidgetSnapshot(tasks: tasks, generated: date), order: .due, category: nil)
    }
}

struct TasksWidgetView: View {
    let entry: TasksWidgetEntry
    let family: WidgetFamily

    var body: some View {
        Group {
            switch family {
            case .systemSmall: small
            case .systemMedium: list(rows: 4, plusSize: 34)
            default: list(rows: 9, plusSize: 38)
            }
        }
        .widgetURL(DeepLink.tasks)
    }

    // MARK: Small: count, three titles, the + (an intent — small widgets
    // allow only the one widget-wide link).

    private var small: some View {
        VStack(alignment: .leading, spacing: 0) {
            header(plus: nil)
                .padding(.bottom, 8)
            if entry.tasks.isEmpty {
                emptyText
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(entry.tasks.prefix(3)) { task in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            circle
                            Text(task.title)
                                .font(.footnote.weight(isUrgent(task) ? .semibold : .regular))
                                .lineLimit(1)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
            HStack(alignment: .bottom) {
                moreText(shown: 3)
                Spacer(minLength: 0)
                Button(intent: NewTaskIntent()) { PlusCircle(size: 34) }
                    .buttonStyle(.plain)
            }
        }
    }

    // MARK: Medium / large: header with the + link, rows with due labels.
    // No "+N more" footer here — the header count already says it.

    private func list(rows: Int, plusSize: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header(plus: plusSize)
                .padding(.bottom, family == .systemLarge ? 12 : 8)
            if entry.tasks.isEmpty {
                emptyText
            } else {
                VStack(alignment: .leading, spacing: family == .systemLarge ? 11 : 6) {
                    ForEach(entry.tasks.prefix(rows)) { task in
                        row(task)
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func row(_ task: WidgetSnapshot.Task) -> some View {
        let urgent = isUrgent(task)
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            circle
            Text(task.title)
                .font(.subheadline.weight(urgent ? .semibold : .regular))
                .lineLimit(1)
            Spacer(minLength: 8)
            if let due = dueLabel(task) {
                Text(due)
                    .font(.caption.weight(urgent ? .semibold : .regular))
                    .foregroundStyle(urgent ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                    .lineLimit(1)
                    .fixedSize()
            }
        }
    }

    // MARK: Parts

    private func header(plus: CGFloat?) -> some View {
        HStack(alignment: .center) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(entry.category.map { "#\($0)" } ?? "Tasks")
                    .font(.headline.weight(.bold))
                    .lineLimit(1)
                if entry.hasData {
                    Text("\(entry.tasks.count)")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 4)
            if let plus {
                Link(destination: DeepLink.newTask) { PlusCircle(size: plus) }
            }
        }
    }

    private var circle: some View {
        Image(systemName: "circle")
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private var emptyText: some View {
        if entry.hasData {
            Text(entry.category == nil ? "All clear." : "Nothing in this category.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else {
            Text("Open stash once to show your tasks here.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func moreText(shown: Int) -> some View {
        if entry.tasks.count > shown {
            Text("+\(entry.tasks.count - shown) more")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func isUrgent(_ task: WidgetSnapshot.Task) -> Bool {
        guard let raw = task.deadline, let date = Dates.deadline(raw) else { return false }
        return Dates.daysUntil(date, now: entry.date) <= 0
    }

    /// Short right-column label: "Overdue", "Today", "Tomorrow", "Friday", "3 Nov".
    private func dueLabel(_ task: WidgetSnapshot.Task) -> String? {
        guard let raw = task.deadline, let date = Dates.deadline(raw) else { return nil }
        return Dates.daysUntil(date, now: entry.date) < 0 ? "Overdue" : Dates.relativeDay(date, now: entry.date)
    }
}

/// The accent + used by every widget size (same as the app's capture button).
struct PlusCircle: View {
    let size: CGFloat

    var body: some View {
        Image(systemName: "plus")
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Theme.accent, in: .circle)
            .widgetAccentable()
            .accessibilityLabel("New task")
    }
}
