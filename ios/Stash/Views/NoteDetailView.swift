import SwiftUI
import StashCore

/// One note. The first line is the heading (as on the Mac, where it's the
/// title in every list), a quiet meta line sits under it, then the body.
struct NoteDetailView: View {
    let fileName: String

    @Environment(VaultStore.self) private var store
    @Environment(Router.self) private var router
    @State private var editing = false
    @State private var draft = ""
    @FocusState private var editorFocused: Bool

    var body: some View {
        Group {
            if let note = store.note(fileName: fileName) {
                content(note)
                    .navigationTitle(editing ? "Editing" : "")
                    .navigationBarTitleDisplayMode(.inline)
                    .navigationBarBackButtonHidden(editing)
                    .toolbar { toolbar(note) }
                    #if DEBUG
                    .task {
                        if SampleVault.screen == "edit", !editing { draft = note.body; editing = true }
                    }
                    #endif
            } else {
                ContentUnavailableView("Note not found", systemImage: "questionmark.folder",
                                       description: Text("It may have been deleted or renamed on another device."))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
    }

    @ViewBuilder
    private func content(_ note: Note) -> some View {
        if editing {
            TextEditor(text: $draft)
                .font(.body)
                .lineSpacing(5)
                .scrollContentBackground(.hidden)
                .focused($editorFocused)
                .padding(.horizontal, 15) // + TextEditor's own 5pt inset = 20
                .onAppear { editorFocused = true }
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(Self.inline(note.title))
                        .font(.title2.weight(.bold))
                        .strikethrough(note.done == true, color: .secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    meta(note)
                        .font(.footnote)
                        .padding(.top, 8)
                    let rest = Self.bodyAfterTitle(note.body)
                    if !rest.isEmpty {
                        Text(MarkdownRenderer.render(rest) { store.note(linkTarget: $0)?.title })
                            .font(.body)
                            .lineSpacing(5)
                            .textSelection(.enabled)
                            .padding(.top, 22)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 48)
            }
            .environment(\.openURL, OpenURLAction { url in
                guard let id = NoteText.noteID(from: url) else { return .systemAction }
                if let target = store.note(linkTarget: id) {
                    router.path.append(NoteRoute(fileName: target.fileName))
                } else {
                    store.errorMessage = "No note called “\(id)” on this device yet."
                }
                return .handled
            })
            .refreshable { await store.reload() }
        }
    }

    /// "Task · Overdue · Yesterday · #work · 2 Oct" — kind first, then what
    /// matters for it, then tags, then when it was written.
    private func meta(_ note: Note) -> Text {
        var parts: [Meta.Part?] = [Meta.Part(text: note.kind.label)]
        if note.kind == .task {
            if note.done == true {
                parts.append(Meta.Part(text: "Done"))
            } else if let d = note.deadline {
                parts.append(Meta.deadline(d))
            }
        }
        parts.append(Meta.tags(note.tags))
        if let created = Dates.created(note.created) {
            parts.append(Meta.Part(text: created.formatted(.dateTime.day().month(.abbreviated).year())))
        }
        return Meta.text(parts)
    }

    /// The body minus its first non-empty line (shown as the heading).
    static func bodyAfterTitle(_ body: String) -> String {
        var lines = body.components(separatedBy: "\n")
        if let i = lines.firstIndex(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) {
            lines.removeSubrange(...i)
        }
        while let first = lines.first, first.trimmingCharacters(in: .whitespaces).isEmpty { lines.removeFirst() }
        return lines.joined(separator: "\n")
    }

    private static func inline(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(s)
    }

    @ToolbarContentBuilder
    private func toolbar(_ note: Note) -> some ToolbarContent {
        if editing {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { editing = false }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    let body = draft
                    editing = false
                    if body != note.body { Task { await store.setBody(note, body) } }
                }
                .fontWeight(.semibold)
            }
        } else {
            ToolbarItemGroup(placement: .primaryAction) {
                if note.kind == .task {
                    Button {
                        Task { await store.setDone(note, note.done == true ? nil : true) }
                    } label: {
                        Image(systemName: note.done == true ? "arrow.uturn.backward" : "checkmark")
                    }
                    .accessibilityLabel(note.done == true ? "Reopen" : "Complete")
                }
                Button("Edit") {
                    draft = note.body
                    editing = true
                }
            }
        }
    }
}

/// Note body → AttributedString. Inline markdown per line via Foundation;
/// a few block forms are handled by hand because the inline-only parser
/// keeps them as literal text: `#` headings, `-`/`*` bullets, `- [ ]` /
/// `- [x]` checkboxes and ``` fenced code.
enum MarkdownRenderer {
    static func render(_ body: String, titleFor: (String) -> String?) -> AttributedString {
        let source = NoteText.renderable(body, titleFor: titleFor)
        var out = AttributedString()
        var inFence = false
        let lines = source.split(separator: "\n", omittingEmptySubsequences: false)
        for (i, raw) in lines.enumerated() {
            let line = String(raw)
            var piece: AttributedString
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                inFence.toggle()
                continue
            } else if inFence {
                piece = AttributedString(line)
                piece.font = .system(.callout, design: .monospaced)
            } else if let m = line.firstMatch(of: #/^(#{1,6})\s+(.*)$/#) {
                piece = inline(String(m.2))
                piece.font = m.1.count <= 2 ? .title3.bold() : .headline
            } else if let m = line.firstMatch(of: #/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/#) {
                piece = AttributedString(m.1 + (m.2 == " " ? "☐  " : "☑  ")) + inline(String(m.3))
            } else if let m = line.firstMatch(of: #/^(\s*)[-*+]\s+(.*)$/#) {
                piece = AttributedString(m.1 + "•  ") + inline(String(m.2))
            } else {
                piece = inline(line)
            }
            out += piece
            if i < lines.count - 1 { out += AttributedString("\n") }
        }
        // The tint is neutral (same as body text), so links need a mark.
        for run in out.runs where run.link != nil {
            out[run.range].underlineStyle = .single
        }
        return out
    }

    private static func inline(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(s)
    }
}
