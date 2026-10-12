// File I/O against the vault folder (an iCloud Drive folder in practice).
//
// iCloud specifics:
// - A note not yet on this device is either a hidden placeholder
//   (`.<name>.md.icloud`, older iOS) or a real-named file whose
//   downloading status is `.notDownloaded` (newer iOS). Both are listed as
//   pending and asked to download; neither is read, because a coordinated
//   read of a cloud-only file blocks until the download finishes — offline,
//   that is indefinitely.
// - Reads and writes of downloaded files go through NSFileCoordinator so the
//   iCloud daemon never sees a half-written note. Writes are atomic.
// - Listing is a plain directory read (no coordination): coordinating a
//   directory read is not needed to enumerate and can stall on cloud items.

import Foundation

public struct VaultSnapshot: Sendable {
    public var notes: [Note] = []
    /// Note file names present in the cloud but not yet readable here.
    public var pending: [String] = []
    /// Every note file name, local or not — for id collision checks.
    public var allNames: Set<String> = []
    /// Notes read from an older local copy while iCloud fetches a newer one.
    public var outdated = 0
}

public enum VaultFiles {
    public static func scan(_ folder: URL) throws -> VaultSnapshot {
        let keys: [URLResourceKey] = [.isDirectoryKey, .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]
        let items = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: keys, options: [])
        var snap = VaultSnapshot()
        for item in items {
            let name = item.lastPathComponent
            if let real = placeholderTarget(name) {
                snap.allNames.insert(real)
                snap.pending.append(real)
                try? FileManager.default.startDownloadingUbiquitousItem(at: folder.appendingPathComponent(real))
                continue
            }
            guard name.hasSuffix(".md"), !name.hasPrefix(".") else { continue }
            let values = try? item.resourceValues(forKeys: Set(keys))
            if values?.isDirectory == true { continue }
            snap.allNames.insert(name)
            let status = values?.ubiquitousItemDownloadingStatus
            if values?.isUbiquitousItem == true, status != .current {
                try? FileManager.default.startDownloadingUbiquitousItem(at: item)
                if status == .downloaded { snap.outdated += 1 }
            }
            if status == .notDownloaded {
                snap.pending.append(name)
                continue
            }
            // `.downloaded` = an older local copy while a newer one downloads:
            // still worth showing.
            if let text = try? read(item) {
                snap.notes.append(Note(fileName: name, text: text))
            } else {
                snap.pending.append(name)
            }
        }
        snap.pending.sort()
        return snap
    }

    /// `.foo.md.icloud` → `foo.md`; nil for anything else.
    public static func placeholderTarget(_ name: String) -> String? {
        guard name.hasPrefix("."), name.hasSuffix(".md.icloud") else { return nil }
        return String(name.dropFirst().dropLast(".icloud".count))
    }

    public static func read(_ url: URL) throws -> String {
        var coordError: NSError?
        var result: Result<String, Error> = .failure(CocoaError(.fileReadUnknown))
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { u in
            result = Result { String(decoding: try Data(contentsOf: u), as: UTF8.self) }
        }
        if let coordError { throw coordError }
        return try result.get()
    }

    public static func write(_ text: String, to url: URL, mustNotExist: Bool = false) throws {
        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { u in
            do {
                if mustNotExist, FileManager.default.fileExists(atPath: u.path) {
                    throw CocoaError(.fileWriteFileExists)
                }
                try Data(text.utf8).write(to: u, options: .atomic)
            } catch {
                writeError = error
            }
        }
        if let e = coordError ?? writeError { throw e }
    }

    /// Read-modify-write of one note: re-reads the file so frontmatter keys
    /// written elsewhere since the last scan (e.g. the Mac's `enriched:`)
    /// survive the phone's change.
    /// One coordinated read+write, so no other coordinated writer (the iCloud
    /// daemon applying a Mac edit) lands between the read and the write.
    public static func update(_ url: URL, _ transform: (String) -> String) throws -> String {
        var coordError: NSError?
        var result: Result<String, Error> = .failure(CocoaError(.fileWriteUnknown))
        NSFileCoordinator().coordinate(
            readingItemAt: url, options: [],
            writingItemAt: url, options: .forReplacing,
            error: &coordError
        ) { readURL, writeURL in
            result = Result {
                let fresh = transform(String(decoding: try Data(contentsOf: readURL), as: UTF8.self))
                try Data(fresh.utf8).write(to: writeURL, options: .atomic)
                return fresh
            }
        }
        if let coordError { throw coordError }
        return try result.get()
    }
}
