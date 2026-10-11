import SwiftUI
import StashCore

/// The Notes and Knowledge sections' list: every note of one kind, newest
/// first, filtered by the header's search field.
struct KindList: View {
    let kind: NoteKind
    let query: String

    @Environment(VaultStore.self) private var store

    var body: some View {
        let results = NoteList.search(NoteList.newestFirst(store.notes.filter { $0.kind == kind }), query: query)

        List {
            PendingBanner()
            ForEach(results, id: \.fileName) { note in
                NoteRow(note: note)
                    .themedRow()
            }
        }
        .themedList()
        .scrollDismissesKeyboard(.immediately)
        .overlay {
            if results.isEmpty, !store.isLoading, store.pending.isEmpty {
                if query.isEmpty {
                    EmptyState(title: "No \(kind.pluralLabel.lowercased()) yet", symbol: kind.symbol, message: emptyMessage)
                } else {
                    ContentUnavailableView.search(text: query)
                }
            }
        }
        .refreshable { await store.reload() }
    }

    private var emptyMessage: String {
        kind == .knowledge
            ? "Capture something worth keeping — the Mac adds tags and links once it syncs."
            : "Capture a thought with the + button, or on the Mac."
    }
}

/// Title, a two-line plain-text preview, and one meta line. No chevron.
struct NoteRow: View {
    let note: Note

    var body: some View {
        ZStack(alignment: .leading) {
            NavigationLink(value: NoteRoute(fileName: note.fileName)) { EmptyView() }
                .opacity(0)

            VStack(alignment: .leading, spacing: 4) {
                Text(note.title)
                    .font(.body.weight(.medium))
                    .lineLimit(2)
                if let preview {
                    Text(preview)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Meta.text([
                    Dates.created(note.created).map { Meta.Part(text: $0.formatted(.relative(presentation: .named))) },
                    Meta.tags(note.tags),
                ])
                .font(.footnote)
                .lineLimit(1)
                .padding(.top, 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 6)
    }

    /// The body after the title line as plain text: inline markdown reduced
    /// to its characters, list markers dropped, lines joined with " · ".
    private var preview: String? {
        let lines = note.body.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard lines.count > 1 else { return nil }
        let items = lines.dropFirst().map { line -> String in
            let bare = line.replacingOccurrences(of: #"^([-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|#{1,6}\s+)"#, with: "", options: .regularExpression)
            let plain = (try? AttributedString(markdown: bare, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
                .map { String($0.characters) }
            return plain ?? bare
        }
        return items.joined(separator: " · ")
    }
}
