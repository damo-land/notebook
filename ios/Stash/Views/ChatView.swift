import SwiftUI
import StashCore

/// Full-screen chat over the vault. Cited `[[note-id]]`s open the note on
/// this screen's own navigation stack.
struct ChatView: View {
    @Bindable var model: ChatModel

    @Environment(VaultStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var router = Router()
    @State private var draft = ""
    @FocusState private var inputFocused: Bool

    private static let suggestions = [
        "What's due this week?",
        "What's on my plate?",
        "What did I note about agents?",
    ]

    var body: some View {
        NavigationStack(path: $router.path) {
            Group {
                if let reason = model.engine.unavailableReason {
                    ContentUnavailableView {
                        Label("Chat isn't available", systemImage: "sparkles")
                    } description: {
                        Text(reason)
                    }
                } else if model.messages.isEmpty {
                    emptyState
                } else {
                    transcript
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.background)
            .navigationTitle("Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("Close")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("New") { model.newChat() }
                        .disabled(model.messages.isEmpty || model.isResponding)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if model.engine.unavailableReason == nil { inputBar }
            }
            .navigationDestination(for: NoteRoute.self) { NoteDetailView(fileName: $0.fileName) }
        }
        .environment(router)
        .onAppear {
            model.engine.prewarm()
            inputFocused = model.messages.isEmpty
        }
    }

    private var emptyState: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "sparkles").font(.system(size: 34, weight: .light))
            Text("Ask about your notes").font(.title2.weight(.bold))
            Text("Runs on your iPhone with Apple's on-device model — works offline, nothing leaves the phone.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            VStack(spacing: 8) {
                ForEach(Self.suggestions, id: \.self) { s in
                    Button(s) { send(s) }
                        .buttonStyle(ChipStyle())
                }
            }
            .padding(.top, 6)
            Spacer()
            Spacer()
        }
        .padding(32)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    ForEach(model.messages) { message in
                        MessageView(message: message, isStreaming: model.isResponding && message.id == model.messages.last?.id)
                            .id(message.id)
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: model.messages.last?.text) {
                if let last = model.messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
            }
            .environment(\.openURL, OpenURLAction { url in
                guard let id = NoteText.noteID(from: url) else { return .systemAction }
                if let note = store.note(linkTarget: id) {
                    router.path.append(NoteRoute(fileName: note.fileName))
                }
                return .handled
            })
        }
    }

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Ask about your notes", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .focused($inputFocused)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Theme.surface, in: .rect(cornerRadius: 20))
                .onSubmit { send(draft) }
            Button {
                send(draft)
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(Theme.ink)
                    .opacity(canSend ? 1 : 0.25)
            }
            .disabled(!canSend)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Theme.background)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isResponding
    }

    private func send(_ text: String) {
        draft = ""
        Task { await model.send(text) }
    }
}

private struct MessageView: View {
    let message: ChatMessage
    let isStreaming: Bool

    var body: some View {
        switch message.role {
        case .user:
            Text(message.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Theme.surface, in: .rect(cornerRadius: 18))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.leading, 48)
        case .assistant:
            if message.text.isEmpty, isStreaming {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Looking through your notes…").foregroundStyle(.secondary)
                }
                .font(.subheadline)
            } else {
                // Citations render as a compact "↗" link: the model usually
                // names the note in its own words right before citing it.
                Text(MarkdownRenderer.render(ChatTools.linkNoteIDs(message.text)) { _ in "↗" })
                    .lineSpacing(4)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        case .notice:
            Label(message.text, systemImage: "exclamationmark.circle")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }
}
