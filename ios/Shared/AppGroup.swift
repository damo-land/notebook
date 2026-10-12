// The App Group container shared by the app and the widget: the task
// snapshot the widget displays, and the "open New task" request the small
// widget's + leaves for the app.

import Foundation
import StashCore

enum AppGroup {
    static let id = "group.land.damo.stash"

    static var container: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id)
    }

    private static var snapshotURL: URL? {
        container?.appendingPathComponent("widget-tasks.json")
    }

    static func readSnapshot() -> WidgetSnapshot? {
        guard let url = snapshotURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? WidgetSnapshot.decode(data)
    }

    static func writeSnapshot(_ snapshot: WidgetSnapshot) throws {
        guard let url = snapshotURL else { return }
        try snapshot.encoded().write(to: url, options: .atomic)
    }

    // MARK: Pending route
    //
    // The small widget's + is an App Intent that opens the app. Which process
    // runs its perform() differs between iOS versions, so instead of calling
    // into the app it leaves this marker; the app takes it whenever it
    // becomes active.

    private static let routeKey = "pendingRoute"

    static func requestRoute(_ url: URL) {
        UserDefaults(suiteName: id)?.set(url.absoluteString, forKey: routeKey)
    }

    static func takeRoute() -> URL? {
        guard let defaults = UserDefaults(suiteName: id),
              let raw = defaults.string(forKey: routeKey) else { return nil }
        defaults.removeObject(forKey: routeKey)
        return URL(string: raw)
    }
}

extension Notification.Name {
    /// Posted by NewTaskIntent after leaving its route. Covers iOS running
    /// the intent inside the app *after* the app became active, when the
    /// scenePhase check has already passed.
    static let stashPendingRoute = Notification.Name("land.damo.stash.pendingRoute")
}

/// URLs the widget opens; handled by RootView.onOpenURL.
enum DeepLink {
    static let tasks = URL(string: "stash://tasks")!
    static let newTask = URL(string: "stash://new?kind=task")!
}

enum WidgetKind {
    static let tasks = "StashTasks"
}
