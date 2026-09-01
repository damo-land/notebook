//! Rebuild proof (acceptance criterion): build an index over a scratch vault,
//! delete the db file, reindex from scratch, and verify the query count still
//! matches an `ls`-equivalent count of `.md` files in the vault.
//!
//! Run with: cargo test --test index_rebuild -- --nocapture

use stash_lib::index::{due_alerts, list_tasks, note_count, open_db, reindex, search_notes};
use std::fs;
use std::path::{Path, PathBuf};

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "stash-index-test-{name}-{}",
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
fn rebuild_from_scratch_matches_vault_ls() {
    let root = scratch_dir("rebuild");
    let vault = root.join("vault");
    fs::create_dir_all(&vault).unwrap();
    // Db lives OUTSIDE the vault dir, mirroring the app-data-dir placement.
    let db_path = root.join("appdata").join("index.db");

    write_note(
        &vault,
        "20260827-090000-groceries.md",
        "id: 20260827-090000-groceries\ncreated: 2026-08-27T09:00:00Z\nkind: task\ntags: [home, errands]\ndeadline: 2026-08-30\ndone: false",
        "Buy groceries\n\nmilk, eggs, bread",
    );
    write_note(
        &vault,
        "20260827-100000-rust-notes.md",
        "id: 20260827-100000-rust-notes\ncreated: 2026-08-27T10:00:00Z\nkind: knowledge\ntags: [rust]",
        "Rust borrow checker notes\n\nlifetimes are regions",
    );
    write_note(
        &vault,
        "20260827-110000-standup.md",
        "id: 20260827-110000-standup\ncreated: 2026-08-27T11:00:00Z\nkind: note\ntags: []\nalert: 2026-08-28T09:00:00Z",
        "Standup reminder",
    );

    // `ls` equivalent: count .md files in the vault.
    let ls_count = fs::read_dir(&vault)
        .unwrap()
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md"))
        .count() as i64;
    assert_eq!(ls_count, 3);

    // Initial index.
    let conn = open_db(&db_path).unwrap();
    let indexed = reindex(&conn, &vault).unwrap();
    assert_eq!(indexed as i64, ls_count);
    assert_eq!(note_count(&conn).unwrap(), ls_count);
    drop(conn);

    // Rebuild proof: delete the db entirely, reindex, count matches ls again.
    fs::remove_file(&db_path).unwrap();
    assert!(!db_path.exists());
    let conn = open_db(&db_path).unwrap();
    reindex(&conn, &vault).unwrap();
    let rebuilt = note_count(&conn).unwrap();
    println!("rebuild proof: vault ls count = {ls_count}, rebuilt db count = {rebuilt}");
    assert_eq!(rebuilt, ls_count);

    // Query sanity over the rebuilt db.
    let hits = search_notes(&conn, "borrow checker").unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, "20260827-100000-rust-notes");
    assert_eq!(hits[0].tags, vec!["rust"]);

    let tasks = list_tasks(&conn, None).unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].kind, "task");
    assert_eq!(tasks[0].deadline.as_deref(), Some("2026-08-30"));
    assert_eq!(tasks[0].done, Some(false));
    assert_eq!(list_tasks(&conn, Some("home")).unwrap().len(), 1);
    assert_eq!(list_tasks(&conn, Some("nope")).unwrap().len(), 0);

    let due = due_alerts(&conn, "2026-08-28T09:00:01Z").unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].id, "20260827-110000-standup");
    assert_eq!(due_alerts(&conn, "2026-08-28T08:59:59Z").unwrap().len(), 0);

    let _ = fs::remove_dir_all(&root);
}
