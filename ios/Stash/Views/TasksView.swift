import SwiftUI
import StashCore

/// A just-completed task, kept for the undo toast.
struct CompletedTask: Equatable {
    let note: Note
    let previous: Bool?
}

/// The Tasks section's list: open tasks by deadline, optionally the
/// completed ones below. Header, filters and capture live in HomeView.
struct TasksList: View {
    @Binding var undo: CompletedTask?

    @Environment(VaultStore.self) private var store
    @AppStorage("taskCategory") private var category = TaskList.allCategories
    @AppStorage("showCompleted") private var showCompleted = false

    var body: some View {
        let allTasks = store.notes.filter { $0.kind == .task }
        let open = TaskList.open(allTasks)
        let active = TaskList.categories(of: open).contains(category) ? category : TaskList.allCategories
        let shown = TaskList.sortByDeadline(TaskList.filter(open, category: active))
        let completed = showCompleted
            ? NoteList.newestFirst(TaskList.filter(allTasks.filter { $0.done == true }, category: active))
            : []

        List {
            PendingBanner()
            ForEach(shown, id: \.fileName) { task in
                TaskRow(task: task) { complete(task) }
                    .themedRow()
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        Button { complete(task) } label: { Label("Done", systemImage: "checkmark") }
                            .tint(Theme.swipe)
                    }
            }
            if !completed.isEmpty {
                Section {
                    ForEach(completed, id: \.fileName) { task in
                        TaskRow(task: task) {
                            Task { await store.setDone(task, nil) }
                        }
                        .themedRow()
                    }
                } header: {
                    SectionLabel(text: "Completed")
                        .padding(.top, 18)
                }
            }
        }
        .themedList()
        .overlay {
            if shown.isEmpty, completed.isEmpty, !store.isLoading, store.pending.isEmpty {
                EmptyState(
                    title: active == TaskList.allCategories ? "All clear" : "Nothing in #\(active)",
                    symbol: "checkmark.circle",
                    message: "Open tasks from your vault show up here."
                )
            }
        }
        .refreshable { await store.reload() }
    }

    private func complete(_ task: Note) {
        let item = CompletedTask(note: task, previous: task.done)
        undo = item
        Task {
            await store.setDone(task, true)
            try? await Task.sleep(for: .seconds(6))
            if undo == item { undo = nil }
        }
    }
}

/// One task: a circle that completes (or, when done, reopens) it, the title,
/// and one quiet meta line. The whole row opens the note; no chevron.
struct TaskRow: View {
    let task: Note
    let onToggle: () -> Void

    private var done: Bool { task.done == true }

    var body: some View {
        ZStack(alignment: .leading) {
            // Hidden link: keeps the row's tap-to-open without the chevron.
            NavigationLink(value: NoteRoute(fileName: task.fileName)) { EmptyView() }
                .opacity(0)

            HStack(alignment: .firstTextBaseline, spacing: 14) {
                Button(action: onToggle) {
                    Image(systemName: done ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 21, weight: .light))
                        .foregroundStyle(done ? .secondary : .primary)
                        .frame(width: 24)
                        .contentShape(.rect.inset(by: -8))
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(done ? "Reopen" : "Complete")

                VStack(alignment: .leading, spacing: 3) {
                    Text(task.title)
                        .lineLimit(3)
                        .strikethrough(done, color: .secondary)
                        .foregroundStyle(done ? .secondary : .primary)
                    if !done, task.deadline != nil || !task.tags.isEmpty {
                        Meta.text([task.deadline.map(Meta.deadline), Meta.tags(task.tags)])
                            .font(.footnote)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.vertical, 6)
    }
}

struct UndoToast: View {
    let title: String
    let onUndo: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
            Text(title).lineLimit(1).font(.subheadline)
            Spacer(minLength: 8)
            Button("Undo", action: onUndo)
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.plain)
        }
        .foregroundStyle(.primary)
        .padding(.horizontal, 18)
        .frame(height: 58)
        .floatingGlass(in: .capsule)
    }
}
