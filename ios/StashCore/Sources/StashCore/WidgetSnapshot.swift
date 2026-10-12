// What the home-screen widget shows, as the app last saw it. The widget runs
// in its own process and can't open the iCloud vault (the folder permission
// belongs to the app), so the app writes this small JSON file into the
// shared App Group container after every scan or change, and the widget
// reads only that.

import Foundation

public struct WidgetSnapshot: Codable, Equatable, Sendable {
    public struct Task: Codable, Equatable, Sendable, Identifiable {
        public var id: String { fileName }
        public let fileName: String
        public let title: String
        public let deadline: String?
        public let tags: [String]
        public let created: String

        public init(fileName: String, title: String, deadline: String?, tags: [String], created: String) {
            self.fileName = fileName
            self.title = title
            self.deadline = deadline
            self.tags = tags
            self.created = created
        }
    }

    /// Per-widget setting: Tasks-view order (default) or newest first.
    public enum Order: String, Codable, Sendable, CaseIterable {
        case due, newest
    }

    /// Open tasks in Tasks-view order (deadline first; see TaskList).
    public var tasks: [Task]
    public var generated: Date

    public init(tasks: [Task], generated: Date) {
        self.tasks = tasks
        self.generated = generated
    }

    /// Open tasks from the vault, capped so the file stays small.
    public init(notes: [Note], generated: Date = Date(), limit: Int = 100) {
        tasks = TaskList.sortByDeadline(TaskList.open(notes)).prefix(limit).map {
            Task(fileName: $0.fileName, title: $0.title, deadline: $0.deadline, tags: $0.tags, created: $0.created)
        }
        self.generated = generated
    }

    /// nil, empty or "all"/"All" (the widget picker's first option): no
    /// category filter.
    public static func isAllCategories(_ category: String?) -> Bool {
        guard let category, !category.isEmpty else { return true }
        return category.lowercased() == TaskList.allCategories
    }

    /// The tasks a widget shows for its settings.
    public func tasks(order: Order, category: String?) -> [Task] {
        var list = tasks
        if !Self.isAllCategories(category), let category {
            list = list.filter { $0.tags.contains(category) }
        }
        switch order {
        case .due:
            return list
        case .newest:
            return list.enumerated().sorted { l, r in
                if l.element.created != r.element.created { return jsLess(r.element.created, l.element.created) }
                return l.offset < r.offset
            }.map(\.element)
        }
    }

    /// Every category (tag) on an open task, sorted — the widget's
    /// category picker.
    public var categories: [String] {
        Set(tasks.flatMap(\.tags)).sorted(by: jsLess)
    }

    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }

    public static func decode(_ data: Data) throws -> WidgetSnapshot {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(WidgetSnapshot.self, from: data)
    }
}
