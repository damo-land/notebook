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
            #if DEBUG
            if CommandLine.arguments.contains("-chatFocus") { inputFocused = true }
            #endif
        }
    }

    /// Scrollable, so with the keyboard up it shrinks instead of pushing
    /// the input field under the keyboard.
    private var emptyState: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 18) {
                    Image(systemName: "sparkles").font(.system(size: 34, weight: .light))
                    Text("Ask about your notes").font(.title2.weight(.bold))
                    Text("Runs on your iPhone with Apple's on-device model. Works offline, nothing leaves the phone.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    VStack(spacing: 8) {
                        ForEach(Self.suggestions, id: \.self) { s in
                            Button(s) { send(s) }
                                .buttonStyle(ChipStyle())
                        }
                    }
                    .padding(.top, 6)
                }
                .padding(.horizontal, 32)
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    /// The conversation. Content is never shorter than the visible area
    /// (messages top-aligned, spare room below), so pinning to the bottom
    /// can't push a short conversation down the screen; a long one always
    /// shows its newest message above the input, keyboard up or down.
    private var transcript: some View {
        GeometryReader { geo in
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        LazyVStack(alignment: .leading, spacing: 16) {
                            ForEach(model.messages) { message in
                                MessageView(message: message, isStreaming: model.isResponding && message.id == model.messages.last?.id)
                            }
                        }
                        .padding(16)
                        Spacer(minLength: 0)
                        Color.clear.frame(height: 1).id(Self.bottomID)
                    }
                    // geo.size is already the visible area (bars, input and
                    // keyboard excluded); subtracting insets again made short
                    // conversations shorter than the screen and pushed them down.
                    .frame(minHeight: geo.size.height, alignment: .top)
                }
                .defaultScrollAnchor(.bottom)
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: model.messages.count) { proxy.scrollTo(Self.bottomID, anchor: .bottom) }
                .onChange(of: model.messages.last?.text) { proxy.scrollTo(Self.bottomID, anchor: .bottom) }
                .onChange(of: geo.size.height) { proxy.scrollTo(Self.bottomID, anchor: .bottom) }
                .environment(\.openURL, OpenURLAction { url in
                    guard let id = NoteText.noteID(from: url) else { return .systemAction }
                    if let note = store.note(linkTarget: id) {
                        router.path.append(NoteRoute(fileName: note.fileName))
                    }
                    return .handled
                })
            }
        }
    }

    private static let bottomID = "bottom"

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

    @Environment(VaultStore.self) private var store

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
                // Citations become links without ever hiding what the model
                // wrote (see NoteText.chatMarkdown).
                Text(MarkdownRenderer.render(NoteText.chatMarkdown(message.text, notes: store.notes)) { _ in nil })
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
