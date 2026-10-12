import SwiftUI
import WidgetKit
import StashCore

struct TasksWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: WidgetKind.tasks, intent: TasksWidgetConfig.self, provider: TasksProvider()) { entry in
            FamilyView(entry: entry)
                .containerBackground(Theme.background, for: .widget)
        }
        .configurationDisplayName("Tasks")
        .description("Your open tasks, due first. Tap + to add one.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

private struct FamilyView: View {
    let entry: TasksWidgetEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        TasksWidgetView(entry: entry, family: family)
    }
}

/// Reads the snapshot the app published. Two entries per timeline — now and
/// the coming midnight — so "Today" turns into "Overdue" on time; the app
/// asks for a fresh timeline whenever its tasks change.
struct TasksProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> TasksWidgetEntry {
        .sample()
    }

    func snapshot(for configuration: TasksWidgetConfig, in context: Context) async -> TasksWidgetEntry {
        let snapshot = AppGroup.readSnapshot()
        // The widget gallery shows sample tasks until the app has run once.
        if snapshot == nil, context.isPreview { return .sample() }
        return entry(configuration, snapshot: snapshot, at: .now)
    }

    func timeline(for configuration: TasksWidgetConfig, in context: Context) async -> Timeline<TasksWidgetEntry> {
        let snapshot = AppGroup.readSnapshot()
        let now = Date.now
        let midnight = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: now))!
        return Timeline(
            entries: [entry(configuration, snapshot: snapshot, at: now), entry(configuration, snapshot: snapshot, at: midnight)],
            policy: .atEnd
        )
    }

    private func entry(_ configuration: TasksWidgetConfig, snapshot: WidgetSnapshot?, at date: Date) -> TasksWidgetEntry {
        TasksWidgetEntry(date: date, snapshot: snapshot, order: configuration.order.order, category: configuration.category)
    }
}
