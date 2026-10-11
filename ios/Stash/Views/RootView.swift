import SwiftUI
import StashCore

struct NoteRoute: Hashable {
    let fileName: String
}

/// The navigation path of a stack, so a `[[wiki-link]]` tapped inside a note
/// can push the linked note onto the stack it was tapped in.
@Observable
@MainActor
final class Router {
    var path: [NoteRoute] = []
}

struct CaptureRequest: Identifiable {
    let id = UUID()
    let kind: NoteKind
}

struct RootView: View {
    @Environment(VaultStore.self) private var store
    @AppStorage("section") private var section = "tasks"
    @State private var capture: CaptureRequest?
    @State private var showSettings = false
    @State private var chat: ChatModel?
    @State private var presentedChat: ChatModel?

    var body: some View {
        @Bindable var store = store
        Group {
            if store.folder == nil {
                OnboardingView()
            } else {
                HomeView(
                    section: $section,
                    onCapture: { capture = CaptureRequest(kind: $0) },
                    onSettings: { showSettings = true },
                    onChat: ChatModel.isSupported ? { openChat() } : nil
                )
            }
        }
        .sheet(item: $capture) { CaptureView(initialKind: $0.kind) }
        .sheet(isPresented: $showSettings) { SettingsView() }
        // By item, not isPresented: the model is created in the same update
        // that presents it, and an isPresented closure can still see nil.
        .fullScreenCover(item: $presentedChat) { ChatView(model: $0) }
        .alert("Something went wrong", isPresented: Binding(
            get: { store.errorMessage != nil },
            set: { if !$0 { store.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.errorMessage ?? "")
        }
        #if DEBUG
        .task {
            switch SampleVault.screen {
            case "tasks": section = "tasks"
            case "notes": section = "notes"
            case "knowledge", "detail", "edit": section = "knowledge"
            case "taskdetail", "undo": section = "tasks"
            case "capture": capture = CaptureRequest(kind: .task)
            case "capture-note": capture = CaptureRequest(kind: .note)
            case "capture-knowledge": capture = CaptureRequest(kind: .knowledge)
            case "settings": showSettings = true
            case "chat":
                openChat()
                if let prompt = SampleVault.argument("-chatPrompt") { await chat?.send(prompt) }
            default: break
            }
        }
        #endif
    }

    /// The chat model lives here, not in the cover, so closing chat keeps
    /// the conversation for the rest of the session (as on the Mac).
    private func openChat() {
        if chat == nil { chat = ChatModel.make(store: store) }
        presentedChat = chat
    }
}

// MARK: - Home

/// The one main screen. Navigation pattern (no tab bar, no segmented
/// control):
/// - a slim top row with the rare actions (✦ chat, ⋯ filters + settings);
/// - the section names as a large typographic title — the current one solid,
///   the others dimmed, tap to switch;
/// - plain content;
/// - one floating glass + in the thumb zone for the frequent action, capture.
/// Notes push over everything on a single navigation stack.
struct HomeView: View {
    @Binding var section: String
    let onCapture: (NoteKind) -> Void
    let onSettings: () -> Void
    let onChat: (() -> Void)?

    @Environment(VaultStore.self) private var store
    @State private var router = Router()
    @State private var query = ""
    @State private var undo: CompletedTask?
    @AppStorage("taskCategory") private var category = TaskList.allCategories
    @AppStorage("showCompleted") private var showCompleted = false

    private var kind: NoteKind {
        switch section {
        case "notes": .note
        case "knowledge": .knowledge
        default: .task
        }
    }

    var body: some View {
        NavigationStack(path: $router.path) {
            content
                .safeAreaInset(edge: .top, spacing: 0) { header }
                .safeAreaInset(edge: .bottom, spacing: 0) { bottomControls }
                .toolbar(.hidden, for: .navigationBar)
                .navigationTitle(kind.pluralLabel) // back-button label on pushed notes
                .navigationDestination(for: NoteRoute.self) { NoteDetailView(fileName: $0.fileName) }
                .animation(.snappy, value: undo)
        }
        .environment(router)
        .onChange(of: section) { query = "" }
        #if DEBUG
        .task(id: store.notes.count) {
            // `-screen detail`: open the first note with a wiki-link.
            // `-screen detail|edit|taskdetail|undo`: put a note on screen.
            guard router.path.isEmpty, undo == nil else { return }
            switch SampleVault.screen {
            case "detail", "edit":
                if let n = store.notes.first(where: { $0.kind == .knowledge && $0.body.contains("[[") }) {
                    router.path = [NoteRoute(fileName: n.fileName)]
                }
            case "taskdetail":
                if let t = TaskList.open(store.notes).first(where: { $0.deadline != nil }) {
                    router.path = [NoteRoute(fileName: t.fileName)]
                }
            case "undo":
                if let t = TaskList.open(store.notes).first { undo = CompletedTask(note: t, previous: nil) }
            default: break
            }
        }
        #endif
    }

    @ViewBuilder
    private var content: some View {
        switch kind {
        case .task: TasksList(undo: $undo)
        default: KindList(kind: kind, query: query)
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer()
                // Both actions in one glass capsule (iOS 26's grouped-button
                // look, same material as the + button), plain matching glyphs.
                HStack(spacing: 0) {
                    if let onChat {
                        Button(action: onChat) { headerGlyph("sparkles") }
                            .accessibilityLabel("Chat")
                    }
                    Menu { menuItems } label: {
                        headerGlyph(filterActive ? "line.3.horizontal.decrease" : "ellipsis")
                    }
                    .accessibilityLabel(filterActive ? "Filters on" : "More")
                }
                .buttonStyle(.plain)
                .floatingGlass(in: .capsule)
            }
            .padding(.bottom, 14)

            SectionTitles(section: $section)

            if kind != .task {
                SearchField(text: $query, prompt: "Search \(kind.pluralLabel.lowercased())")
                    .padding(.top, 8)
            } else if category != TaskList.allCategories {
                FilterChip(label: "#\(category)") { category = TaskList.allCategories }
                    .padding(.top, 6)
            }
        }
        .padding(.horizontal, 16) // lines up with the list rows
        .padding(.bottom, 12)
        .background(Theme.background)
    }

    private var filterActive: Bool { kind == .task && category != TaskList.allCategories }

    private func headerGlyph(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(.primary)
            .frame(width: 46, height: 40)
            .contentShape(.rect)
    }

    @ViewBuilder
    private var menuItems: some View {
        if kind == .task {
            let categories = TaskList.categories(of: TaskList.open(store.notes))
            if categories.count > 1 {
                Picker("Category", selection: $category) {
                    ForEach(categories, id: \.self) { c in
                        Text(c == TaskList.allCategories ? "All tasks" : "#\(c)").tag(c)
                    }
                }
            }
            Toggle("Show completed", systemImage: "checkmark.circle", isOn: $showCompleted)
            Divider()
        }
        Button("Settings", systemImage: "gearshape", action: onSettings)
    }

    // MARK: Bottom

    private var bottomControls: some View {
        HStack(alignment: .bottom, spacing: 12) {
            if let undo {
                UndoToast(title: undo.note.title) {
                    self.undo = nil
                    Task { await store.setDone(undo.note, undo.previous) }
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            } else {
                Spacer()
            }
            CaptureButton { onCapture(kind) }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }
}

/// "Tasks  Notes  Knowledge" as one large title: the current section solid,
/// the others dimmed. Falls back to smaller type on narrow phones.
struct SectionTitles: View {
    @Binding var section: String

    private static let sections = [("tasks", "Tasks"), ("notes", "Notes"), ("knowledge", "Knowledge")]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            titles(.largeTitle)
            titles(.title)
            titles(.title2)
        }
    }

    private func titles(_ style: Font.TextStyle) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 18) {
            ForEach(Self.sections, id: \.0) { id, title in
                let selected = section == id
                Button {
                    withAnimation(.snappy) { section = id }
                } label: {
                    Text(title)
                        .font(.system(style, weight: .bold))
                        .foregroundStyle(selected ? AnyShapeStyle(.primary) : AnyShapeStyle(.tertiary))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? [.isHeader, .isSelected] : [])
            }
        }
        .fixedSize()
    }
}

/// The floating capture button — the one place the accent colour appears.
struct CaptureButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 58, height: 58)
                .background(Theme.accent, in: .circle)
                .shadow(color: Theme.accent.opacity(0.35), radius: 10, y: 4)
                .contentShape(.circle)
        }
        .buttonStyle(PressScaleStyle())
        .accessibilityLabel("New")
    }
}

/// Slight shrink on press, for buttons that draw their own background.
struct PressScaleStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

extension View {
    /// Liquid Glass on iOS 26; a material with a soft shadow before it.
    @ViewBuilder
    func floatingGlass<S: Shape>(in shape: S) -> some View {
        if #available(iOS 26, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else {
            background(.regularMaterial, in: shape)
                .shadow(color: .black.opacity(0.15), radius: 10, y: 3)
        }
    }
}

struct FilterChip: View {
    let label: String
    let onClear: () -> Void

    var body: some View {
        Button(action: onClear) {
            HStack(spacing: 4) {
                Text(label)
                Image(systemName: "xmark").font(.caption2.weight(.bold))
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(Theme.onInk)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Theme.ink, in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear filter \(label)")
    }
}

struct SearchField: View {
    @Binding var text: String
    let prompt: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField(prompt, text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Theme.surface, in: .rect(cornerRadius: 12))
    }
}

// MARK: - Onboarding

struct OnboardingView: View {
    @Environment(VaultStore.self) private var store
    @State private var picking = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "folder")
                .font(.system(size: 52, weight: .light))
            VStack(spacing: 10) {
                Text("Open your vault").font(.title.bold())
                Text("Pick the **Stash** folder in iCloud Drive — the same folder the Mac app saves to. Your notes stay plain markdown files; nothing leaves iCloud.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            Button {
                picking = true
            } label: {
                Label("Choose folder", systemImage: "folder")
                    .frame(maxWidth: .infinity)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.onInk)
                    .padding(.vertical, 15)
                    .background(Theme.ink, in: .capsule)
            }
            .buttonStyle(.plain)
            Spacer()
            Text("On the Mac: move the vault into iCloud Drive, then point stash at it in Settings.")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.tertiary)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
        .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result { store.choose(url) }
        }
    }
}
