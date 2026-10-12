import SwiftUI
import StashCore

struct SettingsView: View {
    @Environment(VaultStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var picking = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Folder", value: store.folderName)
                    LabeledContent("Notes on this phone", value: "\(store.notes.count)")
                    if !store.pending.isEmpty {
                        LabeledContent("Still downloading") {
                            HStack(spacing: 6) {
                                ProgressView().controlSize(.small)
                                Text("\(store.pending.count)")
                            }
                        }
                    }
                    if let last = store.lastLoaded {
                        LabeledContent("Last checked") {
                            Text(last, format: .relative(presentation: .named))
                        }
                    }
                } header: {
                    SectionLabel(text: "Vault")
                } footer: {
                    Text("Notes live in iCloud Drive as plain markdown, shared with the Mac. stash downloads every note when it opens, so open it once on Wi-Fi before you lose signal. The home-screen widget shows your tasks as of the last time stash ran; iOS also refreshes it in the background now and then.")
                }
                .listRowBackground(Theme.cell)

                Section {
                    Button("Check for changes now") { Task { await store.reload() } }
                    Button("Choose another folder…") { picking = true }
                } footer: {
                    Text("On the Mac, right-click the vault folder in Finder and choose **Keep Downloaded** so the Mac app always sees every note.")
                }
                .listRowBackground(Theme.cell)

                Section {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "–")
                }
                .listRowBackground(Theme.cell)
            }
            .themedForm()
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
                if case .success(let url) = result { store.choose(url) }
            }
        }
        .presentationBackground(Theme.background)
    }
}
