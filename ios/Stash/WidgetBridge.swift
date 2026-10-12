// Publishes the open tasks to the widget: writes the snapshot into the App
// Group and asks WidgetKit for fresh timelines — only when the tasks the
// widget would show actually changed, since widget reloads are budgeted.

import WidgetKit
import StashCore

@MainActor
enum WidgetBridge {
    private static var lastPublished: [WidgetSnapshot.Task]?

    static func publish(_ notes: [Note]) {
        let snapshot = WidgetSnapshot(notes: notes)
        guard snapshot.tasks != lastPublished else { return }
        do {
            try AppGroup.writeSnapshot(snapshot)
            lastPublished = snapshot.tasks
            WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.tasks)
        } catch {
            // The widget keeps showing the previous snapshot; nothing to tell
            // the user mid-task.
        }
    }
}
