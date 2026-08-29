//! Alert scheduler proof (T9 acceptance criterion): seed a scratch vault with
//! a note due one minute ago and one due in an hour, run the scheduler's
//! selection+marking pass, and verify exactly the past-due one is selected,
//! is marked `alerted: true` in its frontmatter with the rest of the file
//! preserved byte for byte, and is NOT selected again on a second pass — nor
//! after the index is rebuilt from scratch.
//!
//! No Tauri runtime involved: `take_due_alerts` is the entire scheduler
//! decision. Firing the actual macOS notification is the one manual step.
//!
//! Run with: cargo test --test alert_scheduler -- --nocapture

use notebook_lib::alerts::{is_alerted, iso_utc, now_iso_utc, take_due_alerts};
use notebook_lib::index::{note_count, open_db, reindex};
use std::fs;
use std::path::{Path, PathBuf};

/// The scheduler's "now" for this test. Note A is one minute past it, note B
/// an hour ahead.
const NOW: &str = "2026-08-28T09:00:00Z";

const NOTE_A: &str = "20260828-085000-standup.md";
const NOTE_B: &str = "20260828-085500-review.md";
const NOTE_C: &str = "20260828-080000-already.md";
const NOTE_D: &str = "20260828-080000-finished.md";

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "notebook-alerts-test-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_note(vault: &Path, name: &str, fm: &str, body: &str) {
    fs::write(vault.join(name), format!("---\n{fm}\n---\n{body}")).unwrap();
}

fn read_note(vault: &Path, name: &str) -> String {
    fs::read_to_string(vault.join(name)).unwrap()
}

/// Splits a note file the way both parsers do: frontmatter lines, then the
/// body bytes after the closing `---`.
fn split_note(text: &str) -> (Vec<String>, String) {
    let rest = text.strip_prefix("---\n").expect("note has frontmatter");
    let end = rest.find("\n---\n").expect("frontmatter is closed");
    (
        rest[..end].lines().map(str::to_string).collect(),
        rest[end + 5..].to_string(),
    )
}

#[test]
fn fires_past_due_alerts_once_and_only_once() {
    let root = scratch_dir("scheduler");
    let vault = root.join("vault");
    fs::create_dir_all(&vault).unwrap();
    let db_path = root.join("appdata").join("index.db");

    // A: due one minute before NOW, never alerted -> must fire.
    write_note(
        &vault,
        NOTE_A,
        "id: 20260828-085000-standup\ncreated: 2026-08-28T08:50:00Z\nkind: note\ntags: [work]\nalert: 2026-08-28T08:59:00Z",
        "Standup reminder\n\nsecond paragraph, trailing spaces kept   \n",
    );
    // B: due an hour after NOW -> must not fire.
    write_note(
        &vault,
        NOTE_B,
        "id: 20260828-085500-review\ncreated: 2026-08-28T08:55:00Z\nkind: note\ntags: []\nalert: 2026-08-28T10:00:00Z",
        "Design review\n",
    );
    // C: past due but already marked -> must not fire again.
    write_note(
        &vault,
        NOTE_C,
        "id: 20260828-080000-already\ncreated: 2026-08-28T08:00:00Z\nkind: note\ntags: []\nalert: 2026-08-28T08:00:00Z\nalerted: true",
        "Already notified\n",
    );
    // D: past due but a completed task -> excluded by the due_alerts query
    // itself (proof the scheduler reuses it rather than a second query).
    write_note(
        &vault,
        NOTE_D,
        "id: 20260828-080000-finished\ncreated: 2026-08-28T08:00:00Z\nkind: task\ntags: []\nalert: 2026-08-28T08:00:00Z\ndone: true",
        "Finished task\n",
    );

    let before_a = read_note(&vault, NOTE_A);
    let before_b = read_note(&vault, NOTE_B);
    let before_c = read_note(&vault, NOTE_C);

    let conn = open_db(&db_path).unwrap();
    assert_eq!(reindex(&conn, &vault).unwrap(), 4);

    // --- pass 1: exactly the past-due, unmarked note is selected ------------
    let fired = take_due_alerts(&conn, NOW);
    println!(
        "pass 1 fired: {:?}",
        fired.iter().map(|a| a.id.as_str()).collect::<Vec<_>>()
    );
    assert_eq!(fired.len(), 1, "exactly one note is due and unalerted");
    assert_eq!(fired[0].id, "20260828-085000-standup");
    assert_eq!(fired[0].title, "Standup reminder", "notification body text");
    assert_eq!(fired[0].path, vault.join(NOTE_A).to_string_lossy());

    // --- the marker: one added frontmatter line, everything else verbatim ---
    let after_a = read_note(&vault, NOTE_A);
    assert!(is_alerted(&after_a), "note A is now marked alerted");

    let (fm_before, body_before) = split_note(&before_a);
    let (fm_after, body_after) = split_note(&after_a);
    assert_eq!(body_after, body_before, "body bytes preserved exactly");
    assert_eq!(
        fm_after.len(),
        fm_before.len() + 1,
        "frontmatter gained exactly one line"
    );
    assert_eq!(
        fm_after[..fm_before.len()],
        fm_before[..],
        "existing frontmatter lines untouched, in order"
    );
    assert_eq!(fm_after[fm_before.len()], "alerted: true");
    // Equivalent statement of the same thing, in bytes.
    assert_eq!(
        after_a,
        before_a.replace("\n---\n", "\nalerted: true\n---\n"),
        "only the marker line was inserted"
    );

    // Untouched notes are untouched on disk.
    assert_eq!(read_note(&vault, NOTE_B), before_b, "future alert untouched");
    assert_eq!(read_note(&vault, NOTE_C), before_c, "no duplicate marker");
    assert!(!is_alerted(&before_b));

    // --- pass 2: nothing repeats -------------------------------------------
    let again = take_due_alerts(&conn, NOW);
    assert!(
        again.is_empty(),
        "second pass at the same instant fires nothing, got {:?}",
        again.iter().map(|a| a.id.as_str()).collect::<Vec<_>>()
    );
    assert_eq!(read_note(&vault, NOTE_A), after_a, "pass 2 rewrote nothing");

    // --- the marker survives an index rebuild (why it lives in frontmatter) -
    fs::remove_file(&db_path).unwrap();
    let conn = open_db(&db_path).unwrap();
    assert_eq!(reindex(&conn, &vault).unwrap(), 4);
    assert_eq!(note_count(&conn).unwrap(), 4);
    assert!(
        take_due_alerts(&conn, NOW).is_empty(),
        "rebuilt index must not re-fire an already-alerted note"
    );

    // --- later, B comes due -------------------------------------------------
    let fired = take_due_alerts(&conn, "2026-08-28T10:00:00Z");
    assert_eq!(fired.len(), 1);
    assert_eq!(fired[0].id, "20260828-085500-review");
    assert!(is_alerted(&read_note(&vault, NOTE_B)));

    let _ = fs::remove_dir_all(&root);
}

/// Catch-up-on-start proof: an alert that came due while the app was closed is
/// selected by the very first pass (the scheduler runs one immediately at
/// startup rather than waiting out its poll interval).
#[test]
fn catch_up_pass_selects_alerts_missed_while_closed() {
    let root = scratch_dir("catchup");
    let vault = root.join("vault");
    fs::create_dir_all(&vault).unwrap();
    let db_path = root.join("appdata").join("index.db");

    write_note(
        &vault,
        NOTE_A,
        "id: 20260828-085000-standup\ncreated: 2026-06-01T08:50:00Z\nkind: note\ntags: []\nalert: 2026-06-01T09:00:00Z",
        "Missed while the app was closed\n",
    );

    // Fresh db, fresh index — exactly the state at app start.
    let conn = open_db(&db_path).unwrap();
    reindex(&conn, &vault).unwrap();

    let fired = take_due_alerts(&conn, NOW); // NOW is ~3 months later
    assert_eq!(fired.len(), 1, "long-past alert fires on the first pass");
    assert_eq!(fired[0].title, "Missed while the app was closed");
    assert!(take_due_alerts(&conn, NOW).is_empty(), "and only once");

    let _ = fs::remove_dir_all(&root);
}

/// `iso_utc` must produce the same fixed-width shape as the TS parser writes
/// into `alert`, or the index's string comparison stops being chronological.
#[test]
fn iso_utc_matches_the_frontmatter_shape() {
    assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
    assert_eq!(iso_utc(-1), "1969-12-31T23:59:59Z"); // floor division, not trunc
    assert_eq!(iso_utc(951_782_400), "2000-02-29T00:00:00Z"); // leap day
    assert_eq!(iso_utc(1_787_907_600), "2026-08-28T09:00:00Z");
    assert_eq!(iso_utc(1_787_907_540), "2026-08-28T08:59:00Z");

    let now = now_iso_utc();
    assert_eq!(now.len(), 20, "YYYY-MM-DDTHH:MM:SSZ is 20 chars: {now}");
    assert!(now.ends_with('Z') && now.as_bytes()[10] == b'T', "{now}");
    // Fixed width means lexicographic order is chronological.
    assert!(iso_utc(0) < iso_utc(1) && iso_utc(1) < now, "{now}");
    println!("now_iso_utc() = {now}");
}
