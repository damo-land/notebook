// VaultFiles against a real temp directory. iCloud itself can't be exercised
// here, but its on-disk shapes can: hidden `.name.md.icloud` placeholders,
// the Mac's `.stash-*.tmp` atomic-write temps, and concurrent marker writes.

import Foundation
import Testing
@testable import StashCore

private func tempVault() throws -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("stashcore-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

private func put(_ dir: URL, _ name: String, _ text: String) throws {
    try text.write(to: dir.appendingPathComponent(name), atomically: true, encoding: .utf8)
}

@Test func scanListsNotesAndPlaceholders() throws {
    let dir = try tempVault()
    defer { try? FileManager.default.removeItem(at: dir) }
    try put(dir, "a.md", "---\nid: a\nkind: task\n---\nA")
    try put(dir, "b.md", "plain")
    try put(dir, ".c.md.icloud", "bplist")          // cloud-only note (older iOS)
    try put(dir, ".stash-123-456-0.tmp", "partial") // Mac atomic-write temp
    try put(dir, ".hidden.md", "x")
    try put(dir, "readme.txt", "x")
    try FileManager.default.createDirectory(at: dir.appendingPathComponent("sub.md"), withIntermediateDirectories: true)

    let snap = try VaultFiles.scan(dir)
    #expect(snap.notes.map(\.fileName).sorted() == ["a.md", "b.md"])
    #expect(snap.pending == ["c.md"])
    #expect(snap.allNames == ["a.md", "b.md", "c.md"])
}

@Test func placeholderNames() {
    #expect(VaultFiles.placeholderTarget(".20261009-222436-x.md.icloud") == "20261009-222436-x.md")
    #expect(VaultFiles.placeholderTarget("x.md.icloud") == nil)
    #expect(VaultFiles.placeholderTarget(".x.png.icloud") == nil)
}

@Test func createNeverOverwrites() throws {
    let dir = try tempVault()
    defer { try? FileManager.default.removeItem(at: dir) }
    let url = dir.appendingPathComponent("n.md")
    try VaultFiles.write("first", to: url, mustNotExist: true)
    #expect(throws: (any Error).self) { try VaultFiles.write("second", to: url, mustNotExist: true) }
    #expect(try VaultFiles.read(url) == "first")
}

/// The phone completes a task after the Mac wrote `alerted: true` and
/// `enriched:` behind its back: the re-read must keep both markers.
@Test func doneToggleKeepsMarkersWrittenElsewhere() throws {
    let dir = try tempVault()
    defer { try? FileManager.default.removeItem(at: dir) }
    let url = dir.appendingPathComponent("t.md")
    try put(dir, "t.md", "---\nid: t\ncreated: c\nkind: task\ntags: []\n---\ndo it")
    let stale = Note(fileName: "t.md", text: try VaultFiles.read(url)) // phone's snapshot

    try put(dir, "t.md", "---\nid: t\ncreated: c\nkind: task\ntags: []\nalert: 2026-01-01T09:00:00Z\nalerted: true\nenriched: 2026-01-01T00:00:00Z\n---\ndo it")

    let written = try VaultFiles.update(url) { NoteFactory.update($0, setFrontmatter: [("done", .bool(true))]) }
    #expect(written == "---\nid: t\ncreated: c\nkind: task\ntags: []\ndone: true\nalert: 2026-01-01T09:00:00Z\nalerted: true\nenriched: 2026-01-01T00:00:00Z\n---\ndo it")
    #expect(try VaultFiles.read(url) == written)
    #expect(stale.done == nil)

    // Undo of a completion on a task that never had `done` removes the key.
    let undone = try VaultFiles.update(url) { NoteFactory.update($0, setFrontmatter: [("done", nil)]) }
    #expect(!undone.contains("done:"))
    #expect(undone.contains("alerted: true"))
}

@Test func createdNoteIsReadableByScan() throws {
    let dir = try tempVault()
    defer { try? FileManager.default.removeItem(at: dir) }
    let (name, text) = NoteFactory.create(NewNote(body: "Buy milk", kind: .task, tags: ["home"], deadline: "2026-10-12"), existing: [])
    try VaultFiles.write(text, to: dir.appendingPathComponent(name), mustNotExist: true)
    let note = try #require(try VaultFiles.scan(dir).notes.first)
    #expect(note.fileName == name)
    #expect(note.kind == .task)
    #expect(note.tags == ["home"])
    #expect(note.deadline == "2026-10-12")
    #expect(TaskList.open([note]).count == 1)
}
