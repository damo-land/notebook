//! Search proof (T10 acceptance criterion): search covers body text AND tags.
//!
//! Builds a temp vault with three known notes — one that matches only by body
//! text, one that matches only by a tag (the term appears nowhere in its body
//! or title), and one that matches neither — indexes them, and asserts the
//! right hits come back for each query.
//!
//! Run with: cargo test --test search_notes -- --nocapture

use stash_lib::index::{open_db, reindex, search_notes};
use std::fs;
use std::path::PathBuf;

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "stash-search-test-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_note(vault: &PathBuf, name: &str, fm: &str, body: &str) {
    fs::write(vault.join(name), format!("---\n{fm}\n---\n{body}")).unwrap();
}

fn ids(rows: &[stash_lib::index::NoteRow]) -> Vec<String> {
    rows.iter().map(|r| r.id.clone()).collect()
}

#[test]
fn search_covers_body_text_and_tags() {
    let root = scratch_dir("body-and-tags");
    let vault = root.join("vault");
    fs::create_dir_all(&vault).unwrap();
    let db_path = root.join("appdata").join("index.db");

    // (A) matches "borrow" by body text only — no such tag.
    write_note(
        &vault,
        "20260827-100000-rust-notes.md",
        "id: 20260827-100000-rust-notes\ncreated: 2026-08-27T10:00:00Z\nkind: knowledge\ntags: [rust]",
        "Ownership notes\n\nthe borrow checker rejects aliasing mutation",
    );
    // (B) matches "gardening" by tag only — the word appears in neither the
    // title nor the body, so an FTS/title-only search cannot find it.
    write_note(
        &vault,
        "20260827-110000-tomatoes.md",
        "id: 20260827-110000-tomatoes\ncreated: 2026-08-27T11:00:00Z\nkind: note\ntags: [gardening, home]",
        "Repot the tomatoes\n\nthey outgrew the small pots",
    );
    // (C) matches neither query.
    write_note(
        &vault,
        "20260827-120000-standup.md",
        "id: 20260827-120000-standup\ncreated: 2026-08-27T12:00:00Z\nkind: note\ntags: []",
        "Standup reminder\n\nmention the release date",
    );

    let conn = open_db(&db_path).unwrap();
    assert_eq!(reindex(&conn, &vault).unwrap(), 3);

    // Body-text hit: A only.
    let by_body = search_notes(&conn, "borrow").unwrap();
    println!("query \"borrow\" -> {:?}", ids(&by_body));
    assert_eq!(ids(&by_body), vec!["20260827-100000-rust-notes"]);

    // Title hit still works (first body line).
    let by_title = search_notes(&conn, "Repot").unwrap();
    println!("query \"Repot\" -> {:?}", ids(&by_title));
    assert_eq!(ids(&by_title), vec!["20260827-110000-tomatoes"]);

    // Tag-only hit: B only. This is the criterion's "covers tags" assertion —
    // "gardening" is in B's frontmatter tags and nowhere in its text.
    let raw_b = fs::read_to_string(vault.join("20260827-110000-tomatoes.md")).unwrap();
    let (_, body_b) = raw_b.split_once("\n---\n").unwrap();
    assert!(!body_b.contains("gardening"), "test setup: tag term leaked into body");
    let by_tag = search_notes(&conn, "gardening").unwrap();
    println!("query \"gardening\" -> {:?}", ids(&by_tag));
    assert_eq!(ids(&by_tag), vec!["20260827-110000-tomatoes"]);

    // C is in neither result set, so we are not just matching everything.
    let no_hits = search_notes(&conn, "kubernetes").unwrap();
    println!("query \"kubernetes\" -> {:?}", ids(&no_hits));
    assert!(no_hits.is_empty(), "unrelated query should return no rows");

    // Empty / whitespace query never fires a wildcard.
    assert!(search_notes(&conn, "").unwrap().is_empty());
    assert!(search_notes(&conn, "   ").unwrap().is_empty());

    let _ = fs::remove_dir_all(&root);
}
