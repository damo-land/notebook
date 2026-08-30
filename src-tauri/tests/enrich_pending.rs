//! Enrichment selection proof (T12): which knowledge notes still need an
//! enrichment pass, and what gets handed to the prompt as link candidates.
//!
//! This is the mechanical half of the acceptance criteria — no Tauri runtime,
//! no sidecar, no model call. The other half (append-only writing, the
//! wiki-link cap, bookmark behaviour) is proved by
//! `sidecar/scripts/enrich-demo.ts`.
//!
//! Run with: cargo test --test enrich_pending -- --nocapture

use stash_lib::enrich::{pending_jobs, MAX_CANDIDATES};
use stash_lib::index::{open_db, reindex};
use std::fs;
use std::path::{Path, PathBuf};

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "stash-enrich-test-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_note(vault: &Path, name: &str, fm: &str, body: &str) {
    fs::write(vault.join(name), format!("---\n{fm}\n---\n{body}")).unwrap();
}

#[test]
fn selects_only_unenriched_knowledge_notes() {
    let root = scratch_dir("select");
    let vault = root.join("vault");
    fs::create_dir_all(&vault).unwrap();
    let db_path = root.join("appdata").join("index.db");

    // (a) knowledge, no `enriched` marker -> must be selected.
    write_note(
        &vault,
        "20260827-090000-fts5-notes.md",
        "id: 20260827-090000-fts5-notes\ncreated: 2026-08-27T09:00:00Z\nkind: knowledge\ntags: [sqlite]",
        "SQLite FTS5 notes\n\nhttps://www.sqlite.org/fts5.html is the reference.\n",
    );
    // (b) knowledge, already enriched -> must NOT be selected. This fixture is
    // also the Rust-parser compatibility proof for what the sidecar writes:
    // appended `## Context` section, `[[wiki-links]]`, and the extra `source` /
    // `enriched` frontmatter fields all have to round-trip through
    // `parse_note_file` without disturbing the existing fields.
    write_note(
        &vault,
        "20260827-100000-sqlite-index.md",
        "id: 20260827-100000-sqlite-index\ncreated: 2026-08-27T10:00:00Z\nkind: knowledge\ntags: [sqlite, index]\nsource: https://www.sqlite.org/fts5.html\nenriched: 2026-08-27T10:05:00.000Z",
        "SQLite index design\n\nDerived cache, rebuildable.\n\n## Context\n\nRelated: [[20260827-090000-fts5-notes]].\n",
    );
    // (c) not knowledge -> must NOT be selected, enriched or not.
    write_note(
        &vault,
        "20260827-110000-groceries.md",
        "id: 20260827-110000-groceries\ncreated: 2026-08-27T11:00:00Z\nkind: note\ntags: [home]",
        "Groceries\n\nmilk, eggs\n",
    );
    write_note(
        &vault,
        "20260827-120000-file-taxes.md",
        "id: 20260827-120000-file-taxes\ncreated: 2026-08-27T12:00:00Z\nkind: task\ntags: [admin]\ndeadline: 2026-09-15\ndone: false",
        "File taxes\n\nGather receipts.\n",
    );

    let conn = open_db(&db_path).unwrap();
    assert_eq!(reindex(&conn, &vault).unwrap(), 4);

    let jobs = pending_jobs(&conn, &vault).unwrap();
    let ids: Vec<&str> = jobs.iter().map(|j| j.id.as_str()).collect();
    println!("pending enrichment jobs: {ids:?}");
    assert_eq!(ids, vec!["20260827-090000-fts5-notes"]);

    // The enriched note still parses with every field intact (Rust parser).
    let enriched = jobs
        .iter()
        .find(|j| j.id == "20260827-100000-sqlite-index");
    assert!(enriched.is_none(), "enriched note must not be re-dispatched");
    let hits = stash_lib::index::search_notes(&conn, "Derived cache").unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, "20260827-100000-sqlite-index");
    assert_eq!(hits[0].tags, vec!["index", "sqlite"]);
    assert_eq!(hits[0].kind, "knowledge");

    // Candidates never include the note itself, and only existing notes.
    let job = &jobs[0];
    assert!(!job.related.iter().any(|r| r.id == job.id), "self-link candidate");
    assert!(
        job.related
            .iter()
            .any(|r| r.id == "20260827-100000-sqlite-index"),
        "expected the sqlite note as a related candidate, got {:?}",
        job.related
    );
    assert!(job.path.ends_with("20260827-090000-fts5-notes.md"));

    // Marker semantics: writing `enriched` removes the note from the queue,
    // and clearing it puts the note back (a failed job leaves no marker, so
    // the next app start re-selects it).
    let path = vault.join("20260827-090000-fts5-notes.md");
    let before = fs::read_to_string(&path).unwrap();
    fs::write(
        &path,
        before.replace("kind: knowledge", "kind: knowledge\nenriched: 2026-08-27T09:30:00.000Z"),
    )
    .unwrap();
    reindex(&conn, &vault).unwrap();
    assert!(
        pending_jobs(&conn, &vault).unwrap().is_empty(),
        "marker must stop re-dispatch"
    );
    fs::write(&path, &before).unwrap();
    reindex(&conn, &vault).unwrap();
    assert_eq!(pending_jobs(&conn, &vault).unwrap().len(), 1, "no marker -> retried");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn related_candidates_are_capped() {
    let root = scratch_dir("cap");
    let vault = root.join("vault");
    fs::create_dir_all(&vault).unwrap();
    let db_path = root.join("appdata").join("index.db");

    write_note(
        &vault,
        "20260827-090000-borrow-checker.md",
        "id: 20260827-090000-borrow-checker\ncreated: 2026-08-27T09:00:00Z\nkind: knowledge\ntags: [rust]",
        "Borrow checker lifetimes\n\nRegions, not scopes.\n",
    );
    // Plenty of notes sharing the title keywords.
    for n in 0..(MAX_CANDIDATES + 5) {
        write_note(
            &vault,
            &format!("20260827-1{n:05}-sibling.md"),
            &format!("id: sibling-{n}\ncreated: 2026-08-27T1{n}:00:00Z\nkind: note\ntags: [rust]"),
            "Lifetimes and the borrow checker\n\nmore on lifetimes\n",
        );
    }

    let conn = open_db(&db_path).unwrap();
    reindex(&conn, &vault).unwrap();
    let jobs = pending_jobs(&conn, &vault).unwrap();
    assert_eq!(jobs.len(), 1);
    println!(
        "related candidates: {} (cap {MAX_CANDIDATES})",
        jobs[0].related.len()
    );
    assert_eq!(jobs[0].related.len(), MAX_CANDIDATES);
    assert!(!jobs[0].related.iter().any(|r| r.id == jobs[0].id));

    let _ = fs::remove_dir_all(&root);
}
