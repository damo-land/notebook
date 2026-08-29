//! Durable note writes (T1): every write to a note in the user's vault goes
//! through `atomic_write`, so a crash mid-write can never truncate a real note,
//! and `mark_alerted` refuses to write at all if the note changed underneath it.
//!
//! What is proved here:
//!   * the staging temp file is a sibling of the target (rename(2) is only
//!     atomic within one filesystem — a temp in /tmp would be a cross-device
//!     rename), is never `*.md`, and is gone on both the success and the
//!     failure path;
//!   * a concurrent reader only ever sees the whole old file or the whole new
//!     one, never a torn middle;
//!   * `mark_alerted`'s compare-and-swap aborts with a distinguishable error
//!     and leaves a concurrent writer's bytes byte-for-byte intact;
//!   * the sidecar stdout reader skips an unreadable line instead of ending the
//!     loop on it (which used to strand every pending request waiter forever).
//!
//! Run with: cargo test --test durable_writes -- --nocapture

use notebook_lib::alerts::{is_alerted, mark_alerted, mark_alerted_with};
use notebook_lib::{atomic_write, for_each_readable_line, temp_path_for, WriteError};

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "notebook-durable-test-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Sorted file names in `dir`.
fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

// ---------------------------------------------------------------------------
// The temp file lives in the target's own directory
// ---------------------------------------------------------------------------

#[test]
fn temp_file_is_a_sibling_of_the_target() {
    let vault = scratch_dir("sibling");
    let target = vault.join("20260828-090000-note.md");

    let tmp = temp_path_for(&target);
    assert_eq!(
        tmp.parent(),
        target.parent(),
        "temp must be created in the target's own directory, not /tmp or the app data dir: \
         rename(2) is only atomic within one filesystem"
    );

    // Nested subdirectory: same rule.
    let nested = vault.join("sub").join("dir").join("note.md");
    assert_eq!(temp_path_for(&nested).parent(), nested.parent());

    // A bare relative filename has no directory component at all.
    let bare = Path::new("note.md");
    assert_eq!(temp_path_for(bare).parent(), bare.parent());

    // The vault indexer scans `*.md`; a temp that matched would trigger a
    // spurious reindex even if it only existed for a moment.
    let name = tmp.file_name().unwrap().to_string_lossy().into_owned();
    assert!(!name.ends_with(".md"), "temp must not look like a note: {name}");
    assert!(name.starts_with('.'), "temp should be hidden: {name}");

    // Two calls never collide.
    assert_ne!(temp_path_for(&target), temp_path_for(&target));
}

// ---------------------------------------------------------------------------
// Atomicity is observable, and no temp survives either path
// ---------------------------------------------------------------------------

#[test]
fn a_reader_sees_only_whole_versions_and_no_temp_is_left_behind() {
    let vault = scratch_dir("atomic");
    let target = vault.join("note.md");

    // Big enough that a non-atomic write would be caught in the middle.
    let old: Vec<u8> = std::iter::repeat(b'a').take(64 * 1024).collect();
    let new: Vec<u8> = std::iter::repeat(b'b').take(64 * 1024 + 7).collect();
    fs::write(&target, &old).unwrap();

    let stop = Arc::new(AtomicBool::new(false));
    let reader = {
        let (target, old, new, stop) = (target.clone(), old.clone(), new.clone(), stop.clone());
        let dir = vault.clone();
        std::thread::spawn(move || {
            let mut seen = 0usize;
            let mut torn: Vec<usize> = Vec::new();
            let mut siblings: Vec<String> = Vec::new();
            while !stop.load(Ordering::Relaxed) {
                // A read that fails outright is not a torn read; only the
                // *contents* of a successful read are the claim under test.
                if let Ok(bytes) = fs::read(&target) {
                    seen += 1;
                    if bytes != old && bytes != new {
                        torn.push(bytes.len());
                    }
                }
                for name in entries(&dir) {
                    if name != "note.md" && !siblings.contains(&name) {
                        siblings.push(name);
                    }
                }
            }
            (seen, torn, siblings)
        })
    };

    for i in 0..200 {
        let data = if i % 2 == 0 { &new } else { &old };
        atomic_write(&target, data, None).unwrap();
    }
    stop.store(true, Ordering::Relaxed);
    let (seen, torn, siblings) = reader.join().unwrap();

    assert!(seen > 0, "the reader thread never observed the file");
    assert!(
        torn.is_empty(),
        "reader saw {} partial file(s) (lengths {torn:?}) — the write was not atomic",
        torn.len()
    );
    // Whatever the reader caught mid-flight was staged in this very directory
    // (that is the point) but must never have looked like a note.
    for name in &siblings {
        assert!(!name.ends_with(".md"), "a staging file looked like a note: {name}");
    }
    assert_eq!(
        entries(&vault),
        vec!["note.md".to_string()],
        "success path left a temp file behind"
    );
    assert_eq!(fs::read(&target).unwrap(), old, "last write should be `old`");
}

#[test]
fn a_failed_write_leaves_no_temp_behind() {
    let vault = scratch_dir("failpath");
    // A directory as the target: staging succeeds, the rename over it fails.
    // That is the only failure that exercises cleanup with a temp on disk.
    let target = vault.join("occupied");
    fs::create_dir(&target).unwrap();

    let err = atomic_write(&target, b"whatever", None).unwrap_err();
    assert!(
        matches!(err, WriteError::Io(_)),
        "a rename failure is an I/O failure, not a precondition abort: {err:?}"
    );
    assert_eq!(
        entries(&vault),
        vec!["occupied".to_string()],
        "failure path left a temp file behind"
    );
}

// ---------------------------------------------------------------------------
// mark_alerted's precondition
// ---------------------------------------------------------------------------

const NOTE: &str = "---\nid: 20260828-090000\nalert: 2026-08-28T09:00:00Z\n---\nstandup\n";

#[test]
fn mark_alerted_aborts_when_the_note_changed_underneath() {
    let vault = scratch_dir("cas");
    let note = vault.join("20260828-090000-standup.md");
    fs::write(&note, NOTE).unwrap();

    // What the scheduler read.
    let seen = fs::read(&note).unwrap();

    // A concurrent writer (the user saving an edit from the overlay) gets there
    // first, between that read and the marking write.
    let concurrent = "---\nid: 20260828-090000\nalert: 2026-08-28T09:00:00Z\n---\nstandup, rewritten by the user\n";
    fs::write(&note, concurrent).unwrap();

    let err = mark_alerted_with(&note, &seen).unwrap_err();

    // (c) the error is the precondition variant, not an I/O failure
    assert!(
        matches!(err, WriteError::Changed),
        "expected the precondition variant, got {err:?}"
    );
    // (a) + (b) no write happened; the concurrent writer's bytes are intact
    assert_eq!(
        fs::read(&note).unwrap(),
        concurrent.as_bytes(),
        "the aborted marking must leave the file byte-identical"
    );
    assert!(!is_alerted(concurrent), "no marker may have been written");
    assert_eq!(
        entries(&vault),
        vec!["20260828-090000-standup.md".to_string()],
        "the aborted marking left a temp file behind"
    );
}

#[test]
fn mark_alerted_writes_the_marker_when_nothing_changed() {
    let vault = scratch_dir("cas-ok");
    let note = vault.join("20260828-090000-standup.md");
    fs::write(&note, NOTE).unwrap();

    mark_alerted(&note).unwrap();

    let after = fs::read_to_string(&note).unwrap();
    assert!(is_alerted(&after), "marker not written: {after:?}");
    assert!(after.ends_with("---\nstandup\n"), "body not preserved: {after:?}");
    assert_eq!(entries(&vault), vec!["20260828-090000-standup.md".to_string()]);
}

// ---------------------------------------------------------------------------
// The sidecar stdout reader survives an unreadable line
// ---------------------------------------------------------------------------

#[test]
fn an_unreadable_line_does_not_stop_the_reader_loop() {
    // The middle line is not valid UTF-8, so `Lines` yields `Err` for it. The
    // old `map_while(Result::ok)` ended the iterator right there and every
    // pending sidecar waiter (a UI ping, a background enrichment job) hung
    // forever.
    let stdout: &[u8] = b"{\"id\":1,\"ok\":true}\n\xff\xfe not utf-8\n{\"id\":2,\"ok\":true}\n";

    let mut routed: Vec<String> = Vec::new();
    for_each_readable_line(Cursor::new(stdout), |line| routed.push(line));

    assert_eq!(
        routed,
        vec![
            "{\"id\":1,\"ok\":true}".to_string(),
            "{\"id\":2,\"ok\":true}".to_string()
        ],
        "the line after the bad one must still be routed"
    );
}

