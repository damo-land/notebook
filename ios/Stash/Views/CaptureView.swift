import SwiftUI
import StashCore

/// Phone version of the overlay's capture: a composer, not a form. Kind
/// chips, one large text field, and — for tasks — due date and category as
/// chips (the Mac's `/deadline` and `/category`).
struct CaptureView: View {
    @Environment(VaultStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var text = ""
    @State private var kind: NoteKind
    @State private var due: Date?
    @State private var pickingDate = false
    @State private var category = ""
    @State private var typingCategory = false
    @State private var saving = false
    @FocusState private var focus: Field?

    private enum Field { case text, category }

    init(initialKind: NoteKind) {
        _kind = State(initialValue: initialKind)
        #if DEBUG
        if CommandLine.arguments.contains("-captureDue") {
            _due = State(initialValue: Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: .now)))
            _category = State(initialValue: "work")
        }
        #endif
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    kindChips
                    TextField(placeholder, text: $text, axis: .vertical)
                        .font(.title3)
                        .lineLimit(1...14)
                        .focused($focus, equals: .text)
                    if kind == .task { taskOptions }
                    if kind == .knowledge {
                        Text("The Mac adds tags and links to related notes once it syncs.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 32)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background)
            .navigationTitle("New \(kind.label.lowercased())")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .fontWeight(.semibold)
                        .disabled(trimmed.isEmpty || saving)
                }
            }
            .onAppear { focus = .text }
        }
        .presentationBackground(Theme.background)
    }

    // MARK: Parts

    private var kindChips: some View {
        HStack(spacing: 8) {
            ForEach([NoteKind.note, .task, .knowledge], id: \.self) { k in
                Button(k.label) { withAnimation(.snappy) { kind = k } }
                    .buttonStyle(ChipStyle(selected: kind == k))
            }
        }
    }

    private var taskOptions: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                dueMenu
                categoryMenu
            }
            if pickingDate {
                DatePicker("Due", selection: Binding(
                    get: { due ?? Calendar.current.startOfDay(for: .now) },
                    set: { due = $0 }
                ), displayedComponents: .date)
                .datePickerStyle(.graphical)
                .padding(10)
                .background(Theme.surface, in: .rect(cornerRadius: 16))
            }
            if typingCategory {
                TextField("Category", text: $category)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .category)
                    .submitLabel(.done)
                    .onSubmit { typingCategory = false; focus = .text }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(Theme.surface, in: .rect(cornerRadius: 12))
            }
        }
    }

    private var dueMenu: some View {
        Menu {
            Button("Today") { setDue(days: 0) }
            Button("Tomorrow") { setDue(days: 1) }
            Button("In a week") { setDue(days: 7) }
            Button("Pick a date…") { withAnimation(.snappy) { pickingDate = true } }
            if due != nil {
                Divider()
                Button("No deadline", role: .destructive) { due = nil; pickingDate = false }
            }
        } label: {
            Label(due.map { "Due \(Dates.relativeDay($0).lowercased())" } ?? "Deadline", systemImage: "calendar")
        }
        .buttonStyle(ChipStyle(selected: due != nil))
    }

    private var categoryMenu: some View {
        let existing = Array(TaskList.categories(of: store.notes.filter { $0.kind == .task }).dropFirst())
        let current = category.trimmingCharacters(in: .whitespaces)
        return Menu {
            ForEach(existing, id: \.self) { tag in
                Button("#\(tag)") { category = tag; typingCategory = false }
            }
            if !existing.isEmpty { Divider() }
            Button("New category…") {
                withAnimation(.snappy) { typingCategory = true }
                focus = .category
            }
            if !current.isEmpty {
                Button("No category", role: .destructive) { category = ""; typingCategory = false }
            }
        } label: {
            Label(current.isEmpty ? "Category" : current, systemImage: "number")
        }
        .buttonStyle(ChipStyle(selected: !current.isEmpty))
    }

    private var placeholder: String {
        switch kind {
        case .note: "What's on your mind?"
        case .knowledge: "Something worth keeping"
        case .task: "What needs doing?"
        }
    }

    private func setDue(days: Int) {
        due = Calendar.current.date(byAdding: .day, value: days, to: Calendar.current.startOfDay(for: .now))
        withAnimation(.snappy) { pickingDate = false }
    }

    private func save() {
        saving = true
        let tag = category.trimmingCharacters(in: .whitespaces)
        let input = NewNote(
            body: trimmed,
            kind: kind,
            tags: kind == .task && !tag.isEmpty ? [tag] : [],
            deadline: kind == .task ? due.map(Dates.deadlineString) : nil
        )
        Task {
            if await store.create(input) != nil { dismiss() }
            saving = false
        }
    }
}
