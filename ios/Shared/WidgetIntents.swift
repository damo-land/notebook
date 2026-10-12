// App Intents behind the widget: its per-widget settings (long-press → Edit
// Widget) and the small widget's + button.

import AppIntents
import WidgetKit
import StashCore

enum TaskOrderOption: String, AppEnum {
    case due, newest

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Order"
    static var caseDisplayRepresentations: [TaskOrderOption: DisplayRepresentation] = [
        .due: "Due first",
        .newest: "Newest first",
    ]

    var order: WidgetSnapshot.Order {
        switch self {
        case .due: .due
        case .newest: .newest
        }
    }
}

/// Category choices come from the tasks the app last published, after an
/// "All" that undoes a pick. No snapshot yet means just "All", not an error.
struct CategoryOptions: DynamicOptionsProvider {
    func results() async throws -> [String] {
        ["All"] + (AppGroup.readSnapshot()?.categories ?? [])
    }
}

struct TasksWidgetConfig: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Tasks"
    static var description = IntentDescription("Choose the order and, optionally, one category.")

    @Parameter(title: "Order", default: .due)
    var order: TaskOrderOption

    @Parameter(title: "Category", optionsProvider: CategoryOptions())
    var category: String?

    init() {}

    init(order: TaskOrderOption, category: String?) {
        self.order = order
        self.category = category
    }
}

/// The small widget's +. Small widgets allow a single link (the whole
/// widget, which opens Tasks), so the + is an intent that opens the app and
/// leaves a "new task" request in the App Group for RootView to pick up.
struct NewTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "New task"
    static var description = IntentDescription("Open stash on a new task.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        AppGroup.requestRoute(DeepLink.newTask)
        NotificationCenter.default.post(name: .stashPendingRoute, object: nil)
        return .result()
    }
}
