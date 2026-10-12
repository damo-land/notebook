import SwiftUI
import StashCore

// MARK: - Shared bits

struct EmptyState: View {
    let title: String
    let symbol: String
    let message: String

    var body: some View {
        ContentUnavailableView(title, systemImage: symbol, description: Text(message))
            .foregroundStyle(.secondary)
    }
}

/// Banner shown while iCloud is still downloading notes.
struct PendingBanner: View {
    @Environment(VaultStore.self) private var store

    var body: some View {
        if !store.pending.isEmpty {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Downloading \(store.pending.count) note\(store.pending.count == 1 ? "" : "s") from iCloud…")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
    }
}

/// Small uppercase section label ("COMPLETED").
struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .tracking(0.6)
            .foregroundStyle(.secondary)
    }
}
