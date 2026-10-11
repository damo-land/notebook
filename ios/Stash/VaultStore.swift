// App state: which folder is the vault, what's in it, and every write the
// phone makes. All file I/O runs off the main actor via VaultFiles.

import Foundation
import Observation
import StashCore

@Observable
@MainActor
final class VaultStore {
    private(set) var folder: URL?
    private(set) var notes: [Note] = []
    private(set) var pending: [String] = []
    private(set) var isLoading = false
    private(set) var lastLoaded: Date?
    var errorMessage: String?

    private var allNames: Set<String> = []
    private static let bookmarkKey = "vaultBookmark"

    init() {
        #if DEBUG
        if SampleVault.screen == "onboarding" { return }
        if let sample = SampleVault.folderFromLaunchArguments() ?? SampleVault.folderFromVaultPath() {
            folder = sample
            return
        }
        #endif
        restoreBookmark()
    }

    var folderName: String { folder?.lastPathComponent ?? "" }

    // MARK: Folder

    /// Folder picked in the system picker: keep access for the app's
    /// lifetime and persist a bookmark so the next launch needs no picker.
    func choose(_ url: URL) {
        guard url.startAccessingSecurityScopedResource() else {
            errorMessage = "Couldn't get access to \(url.lastPathComponent)."
            return
        }
        do {
            let data = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
            UserDefaults.standard.set(data, forKey: Self.bookmarkKey)
        } catch {
            errorMessage = "Couldn't remember the folder: \(error.localizedDescription)"
        }
        #if DEBUG
        UserDefaults.standard.removeObject(forKey: SampleVault.debugVaultPathKey)
        #endif
        folder?.stopAccessingSecurityScopedResource()
        folder = url
        notes = []
        pending = []
        activate()
    }

    private func restoreBookmark() {
        guard let data = UserDefaults.standard.data(forKey: Self.bookmarkKey) else { return }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, bookmarkDataIsStale: &stale),
              url.startAccessingSecurityScopedResource() else {
            errorMessage = "Lost access to the vault folder — pick it again in Settings."
            return
        }
        if stale, let fresh = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) {
            UserDefaults.standard.set(fresh, forKey: Self.bookmarkKey)
        }
        folder = url
    }

    // MARK: Loading

    // Refresh while the app is in front:
    // - a watcher on the folder fires when a note is added, removed or
    //   replaced (the Mac's atomic writes and iCloud's downloads are renames);
    // - a poll catches in-place edits the watcher can't see: every 15s, or
    //   every 3s while iCloud is still downloading notes.
    // Both stop in the background; coming back to the front rescans at once.

    private var watcher: DispatchSourceFileSystemObject?
    private var pollTask: Task<Void, Never>?
    private var debounceTask: Task<Void, Never>?
    private var writesInFlight = 0
    private var reloadQueued = false
    private var lastReloadFailed = false

    func activate() {
        startWatching()
        startPolling()
        Task { await reload() }
    }

    func deactivate() {
        watcher?.cancel()
        watcher = nil
        pollTask?.cancel()
        debounceTask?.cancel()
    }

    private func startWatching() {
        watcher?.cancel()
        watcher = nil
        guard let folder else { return }
        let fd = open(folder.path, O_EVTONLY)
        guard fd >= 0 else { return }
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd, eventMask: [.write, .rename, .delete, .link, .extend, .attrib], queue: .main
        )
        source.setEventHandler { [weak self] in
            Task { @MainActor in self?.reloadSoon() }
        }
        source.setCancelHandler { close(fd) }
        source.resume()
        watcher = source
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                let downloading = !(self?.pending.isEmpty ?? true)
                try? await Task.sleep(for: .seconds(downloading ? 3 : 15))
                guard !Task.isCancelled else { return }
                await self?.reload()
            }
        }
    }

    /// Coalesces a burst of watcher events (one save = several) into one scan.
    private func reloadSoon() {
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await self?.reload()
        }
    }

    func reload() async {
        guard let folder else { return }
        // A scan racing the phone's own write could read the old file and
        // undo the optimistic update on screen; the write's own watcher event
        // rescans once it lands.
        guard writesInFlight == 0 else { return }
        guard !isLoading else {
            reloadQueued = true
            return
        }
        isLoading = true
        do {
            let snap = try await Task.detached(priority: .userInitiated) { try VaultFiles.scan(folder) }.value
            // Assign only on change so an idle poll doesn't re-render lists.
            if snap.notes != notes { notes = snap.notes }
            if snap.pending != pending { pending = snap.pending }
            allNames = snap.allNames
            lastLoaded = Date()
            lastReloadFailed = false
        } catch {
            // Report once, not on every poll.
            if !lastReloadFailed {
                errorMessage = "Couldn't read \(folder.lastPathComponent): \(error.localizedDescription)"
            }
            lastReloadFailed = true
        }
        isLoading = false
        if reloadQueued {
            reloadQueued = false
            await reload()
        }
    }

    // MARK: Lookup

    func note(fileName: String) -> Note? {
        notes.first { $0.fileName == fileName }
    }

    /// Resolves a `[[wiki-link]]` target: a note id, or a file name.
    func note(linkTarget: String) -> Note? {
        notes.first { $0.id == linkTarget } ?? notes.first { $0.fileName == linkTarget || $0.fileName == "\(linkTarget).md" }
    }

    // MARK: Writes

    /// `done: true` to complete; `nil` removes the key (undo of a completion
    /// on a task that never had `done`, matching the Mac's undo).
    func setDone(_ note: Note, _ done: Bool?) async {
        await apply(note) { NoteFactory.update($0, setFrontmatter: [("done", done.map(FrontmatterValue.bool))]) }
    }

    func setBody(_ note: Note, _ body: String) async {
        await apply(note) { NoteFactory.update($0, replaceBody: body) }
    }

    /// Optimistic: the in-memory note changes first so the UI responds
    /// instantly; a failed write rolls it back.
    private func apply(_ note: Note, _ transform: @escaping @Sendable (String) -> String) async {
        guard let folder, let idx = notes.firstIndex(where: { $0.fileName == note.fileName }) else { return }
        let before = notes[idx]
        notes[idx] = Note(fileName: note.fileName, text: transform(before.text))
        let url = folder.appendingPathComponent(note.fileName)
        writesInFlight += 1
        defer { writesInFlight -= 1 }
        do {
            let written = try await Task.detached { try VaultFiles.update(url, transform) }.value
            if let i = notes.firstIndex(where: { $0.fileName == note.fileName }) {
                notes[i] = Note(fileName: note.fileName, text: written)
            }
        } catch {
            if let i = notes.firstIndex(where: { $0.fileName == note.fileName }) { notes[i] = before }
            errorMessage = "Couldn't save \(note.title): \(error.localizedDescription)"
        }
    }

    @discardableResult
    func create(_ input: NewNote) async -> Note? {
        guard let folder else { return nil }
        // Fresh listing so a note captured on the Mac a moment ago can't
        // collide; fall back to the last scan if the folder can't be read.
        let names = (try? await Task.detached { try VaultFiles.scan(folder).allNames }.value) ?? allNames
        let (fileName, text) = NoteFactory.create(input, existing: names)
        writesInFlight += 1
        defer { writesInFlight -= 1 }
        do {
            try await Task.detached {
                try VaultFiles.write(text, to: folder.appendingPathComponent(fileName), mustNotExist: true)
            }.value
            let note = Note(fileName: fileName, text: text)
            notes.append(note)
            allNames.insert(fileName)
            return note
        } catch {
            errorMessage = "Couldn't save the note: \(error.localizedDescription)"
            return nil
        }
    }
}
