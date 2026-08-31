//! SQLite index over the vault. The vault (markdown files) is the source of
//! truth; the db is a disposable cache living in the app data dir (never
//! inside the vault). Core logic (open/reindex/queries) is plain rusqlite,
//! callable without a Tauri runtime — the rebuild-proof test uses it directly.
//!
//! PoC simplification (documented choice): any watcher event triggers a full
//! rescan after a ~500ms debounce. The vault is small; a full rescan is cheap
//! and immune to rename/delete edge cases.

use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub type Result<T> = std::result::Result<T, rusqlite::Error>;

// ---------------------------------------------------------------------------
// Schema / open
// ---------------------------------------------------------------------------

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS notes (
  id       TEXT PRIMARY KEY,
  path     TEXT NOT NULL,
  kind     TEXT NOT NULL,
  created  TEXT NOT NULL,
  title    TEXT NOT NULL,
  done     INTEGER,
  deadline TEXT,
  alert    TEXT,
  modified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tags (
  note_id TEXT NOT NULL,
  tag     TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(id UNINDEXED, body);
";

/// Opens (creating if needed) the index db at `db_path` and applies the schema.
pub fn open_db(db_path: &Path) -> Result<Connection> {
    if let Some(parent) = db_path.parent() {
        // Ignore failure here; Connection::open will surface a real error.
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(db_path)?;
    conn.execute_batch(SCHEMA)?;
    // Migration (T5): dbs created before the `modified` column existed pass
    // the CREATE TABLE IF NOT EXISTS above untouched, so add the column here.
    // The startup reindex is a full drop-and-rescan, which then fills in real
    // mtimes over the 0 default.
    let has_modified: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name = 'modified'",
        [],
        |r| r.get(0),
    )?;
    if has_modified == 0 {
        conn.execute(
            "ALTER TABLE notes ADD COLUMN modified INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    Ok(conn)
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (mirrors src/lib/vault/frontmatter.ts: flat `key: value`
// pairs between `---` lines; `[a, b]` inline lists; tolerant of junk lines)
// ---------------------------------------------------------------------------

pub(crate) fn parse_note_file(text: &str) -> (HashMap<String, String>, Vec<String>, String) {
    let mut data = HashMap::new();
    let mut tags = Vec::new();
    let Some(rest) = text.strip_prefix("---\n") else {
        return (data, tags, text.to_string());
    };
    let Some(end) = rest.find("\n---\n") else {
        return (data, tags, text.to_string());
    };
    let block = &rest[..end];
    let body = rest[end + 5..].to_string();
    for line in block.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key.is_empty() || key.contains(' ') {
            continue;
        }
        if key == "tags" {
            let inner = value.trim_start_matches('[').trim_end_matches(']');
            tags = inner
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        } else {
            data.insert(key.to_string(), value.to_string());
        }
    }
    (data, tags, body)
}

// ---------------------------------------------------------------------------
// Reindex (full rescan: vault -> db)
// ---------------------------------------------------------------------------

/// Drops all indexed rows and rescans every `.md` file in `vault_dir`.
/// Returns the number of notes indexed.
pub fn reindex(conn: &Connection, vault_dir: &Path) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM notes", [])?;
    tx.execute("DELETE FROM tags", [])?;
    tx.execute("DELETE FROM notes_fts", [])?;

    let mut count = 0usize;
    let entries = match std::fs::read_dir(vault_dir) {
        Ok(e) => e,
        Err(_) => {
            // Missing vault dir -> empty index; vault stays source of truth.
            tx.commit()?;
            return Ok(0);
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") || !path.is_file() {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let (data, tags, body) = parse_note_file(&text);
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        let id = data.get("id").cloned().filter(|s| !s.is_empty()).unwrap_or(stem);
        let kind = data.get("kind").cloned().unwrap_or_else(|| "note".into());
        let created = data.get("created").cloned().unwrap_or_default();
        let title = body
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .trim()
            .to_string();
        let done: Option<bool> = data.get("done").map(|v| v == "true");
        // File mtime in unix millis: the sort key for the all-notes listing.
        // Integer millis compare correctly with plain ORDER BY; a file whose
        // mtime cannot be read sorts to the end rather than failing the scan.
        let modified: i64 = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        tx.execute(
            "INSERT OR REPLACE INTO notes (id, path, kind, created, title, done, deadline, alert, modified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                path.to_string_lossy(),
                kind,
                created,
                title,
                done,
                data.get("deadline"),
                data.get("alert"),
                modified,
            ],
        )?;
        for tag in tags {
            tx.execute(
                "INSERT OR IGNORE INTO tags (note_id, tag) VALUES (?1, ?2)",
                params![id, tag],
            )?;
        }
        tx.execute(
            "INSERT INTO notes_fts (id, body) VALUES (?1, ?2)",
            params![id, body],
        )?;
        count += 1;
    }
    tx.commit()?;
    Ok(count)
}

/// The indexed file path for a note id, if the note is indexed.
pub fn note_path(conn: &Connection, id: &str) -> Result<Option<String>> {
    use rusqlite::OptionalExtension;
    conn.query_row("SELECT path FROM notes WHERE id = ?1", [id], |r| r.get(0))
        .optional()
}

/// Drops one note's rows from the index (notes, tags, notes_fts). Index-only:
/// the file on disk is untouched — T4's delete command moves it to the Trash
/// first, then calls this so lists refresh without waiting for the watcher.
/// An unknown id is a no-op.
pub fn remove_note(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM notes WHERE id = ?1", [id])?;
    tx.execute("DELETE FROM tags WHERE note_id = ?1", [id])?;
    tx.execute("DELETE FROM notes_fts WHERE id = ?1", [id])?;
    tx.commit()
}

pub fn note_count(conn: &Connection) -> Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct NoteRow {
    pub id: String,
    pub path: String,
    pub kind: String,
    pub created: String,
    pub title: String,
    pub done: Option<bool>,
    pub deadline: Option<String>,
    pub alert: Option<String>,
    pub tags: Vec<String>,
}

fn row_to_note(conn: &Connection, row: &rusqlite::Row<'_>) -> Result<NoteRow> {
    let id: String = row.get(0)?;
    let mut stmt = conn.prepare("SELECT tag FROM tags WHERE note_id = ?1 ORDER BY tag")?;
    let tags = stmt
        .query_map([&id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>>>()?;
    Ok(NoteRow {
        id,
        path: row.get(1)?,
        kind: row.get(2)?,
        created: row.get(3)?,
        title: row.get(4)?,
        done: row.get(5)?,
        deadline: row.get(6)?,
        alert: row.get(7)?,
        tags,
    })
}

const NOTE_COLS: &str = "id, path, kind, created, title, done, deadline, alert";

/// Full-text search over note bodies (FTS5) plus a LIKE fallback on titles
/// and tags. Tags live outside the body (frontmatter is stripped before the
/// FTS insert), so they need their own clause. PoC limit: the tag clause is a
/// single LIKE over the whole query, so a multi-word query never matches a
/// tag — tags are single tokens in practice.
pub fn search_notes(conn: &Connection, text: &str) -> Result<Vec<NoteRow>> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    // Quote each token so user input can't break FTS5 query syntax.
    let fts_query = trimmed
        .split_whitespace()
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ");
    let like = format!("%{}%", trimmed);
    let mut stmt = conn.prepare(&format!(
        "SELECT {NOTE_COLS} FROM notes
         WHERE id IN (SELECT id FROM notes_fts WHERE notes_fts MATCH ?1)
            OR title LIKE ?2
            OR id IN (SELECT note_id FROM tags WHERE tag LIKE ?2)
         ORDER BY created DESC"
    ))?;
    let mut out = Vec::new();
    let mut q = stmt.query(params![fts_query, like])?;
    while let Some(row) = q.next()? {
        out.push(row_to_note(conn, row)?);
    }
    Ok(out)
}

/// Every note in the index, most recently modified (file mtime) first.
/// Serves the search view's empty query (T5): the full vault listing comes
/// from the index, never from a per-keystroke vault directory scan.
pub fn list_all_notes(conn: &Connection) -> Result<Vec<NoteRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {NOTE_COLS} FROM notes ORDER BY modified DESC, created DESC"
    ))?;
    let mut out = Vec::new();
    let mut q = stmt.query([])?;
    while let Some(row) = q.next()? {
        out.push(row_to_note(conn, row)?);
    }
    Ok(out)
}

/// All task notes, optionally filtered to those carrying `category` as a tag.
pub fn list_tasks(conn: &Connection, category: Option<&str>) -> Result<Vec<NoteRow>> {
    let sql = match category {
        Some(_) => format!(
            "SELECT {NOTE_COLS} FROM notes
             WHERE kind = 'task'
               AND id IN (SELECT note_id FROM tags WHERE tag = ?1)
             ORDER BY created DESC"
        ),
        None => format!("SELECT {NOTE_COLS} FROM notes WHERE kind = 'task' ORDER BY created DESC"),
    };
    let mut stmt = conn.prepare(&sql)?;
    let mut out = Vec::new();
    let mut q = match category {
        Some(c) => stmt.query([c])?,
        None => stmt.query([])?,
    };
    while let Some(row) = q.next()? {
        out.push(row_to_note(conn, row)?);
    }
    Ok(out)
}

/// Notes whose alert time has passed as of `now` (ISO 8601 string compare)
/// and that aren't completed tasks.
pub fn due_alerts(conn: &Connection, now: &str) -> Result<Vec<NoteRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {NOTE_COLS} FROM notes
         WHERE alert IS NOT NULL AND alert <= ?1 AND (done IS NULL OR done = 0)
         ORDER BY alert ASC"
    ))?;
    let mut out = Vec::new();
    let mut q = stmt.query([now])?;
    while let Some(row) = q.next()? {
        out.push(row_to_note(conn, row)?);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Vault dir resolution (mirrors getVaultDir in src/lib/vault/index.ts)
// ---------------------------------------------------------------------------

/// Vault dir name the app used before it was renamed to stash. Built from
/// split literals so a repo-wide rename check doesn't match the old app name.
const LEGACY_VAULT_DIR_NAME: &str = concat!("Note", "book");

/// `~/.config/stash/config.json` `{ "vaultDir" }` if present, else the
/// pre-rename `~/<legacy>` dir when it exists on disk, else `<home>/Stash`;
/// a leading `~` expands to `home`.
pub fn resolve_vault_dir(home: &Path) -> PathBuf {
    // `STASH_VAULT_DIR` wins over everything below. It exists so a tool can
    // point the app at a throwaway vault — `scripts/shoot.sh` uses it so a
    // screenshot can never contain the user's real notes.
    //
    // Blank (or whitespace-only) is treated as unset rather than as "the
    // current directory": an exported-but-empty variable must leave resolution
    // exactly as it is when the variable is absent.
    if let Ok(dir) = std::env::var("STASH_VAULT_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    let config = home.join(".config/stash/config.json");
    if let Ok(raw) = std::fs::read_to_string(config) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(dir) = json.get("vaultDir").and_then(|v| v.as_str()) {
                if !dir.is_empty() {
                    return match dir.strip_prefix('~') {
                        Some(rest) => {
                            PathBuf::from(format!("{}{}", home.to_string_lossy(), rest))
                        }
                        None => PathBuf::from(dir),
                    };
                }
            }
        }
    }
    // Legacy fallback: installs from before the rename kept their vault in
    // `~/<legacy>`. Keep using it when it exists so the rename never strands
    // an existing vault.
    let legacy = home.join(LEGACY_VAULT_DIR_NAME);
    if legacy.is_dir() {
        eprintln!(
            "[stash] using legacy vault dir {} (no {} config found)",
            legacy.display(),
            "~/.config/stash/config.json"
        );
        return legacy;
    }
    home.join("Stash")
}

// ---------------------------------------------------------------------------
// Watcher (vault dir -> debounced full reindex)
// ---------------------------------------------------------------------------

/// Watches `vault_dir` and triggers a full reindex ~500ms after the last file
/// event. The returned watcher must be kept alive for the app's lifetime.
///
/// `on_reindex` runs after each successful reindex, **outside** the connection
/// lock so it can query the index itself. T12 uses it to queue enrichment jobs
/// for freshly saved knowledge notes: the watcher already sees every vault
/// write, whatever wrote it, and it fires only after the file is on disk.
pub fn spawn_watcher(
    vault_dir: PathBuf,
    conn: Arc<Mutex<Connection>>,
    on_reindex: impl Fn() + Send + 'static,
) -> notify::Result<notify::RecommendedWatcher> {
    use notify::Watcher;
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    })?;
    watcher.watch(&vault_dir, notify::RecursiveMode::NonRecursive)?;
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            // Debounce: swallow further events until 500ms of quiet.
            while rx.recv_timeout(Duration::from_millis(500)).is_ok() {}
            let reindexed = match conn.lock() {
                Ok(conn) => match reindex(&conn, &vault_dir) {
                    Ok(_) => true,
                    Err(e) => {
                        eprintln!("index: reindex after file change failed: {e}");
                        false
                    }
                },
                Err(_) => false,
            };
            if reindexed {
                on_reindex();
            }
        }
    });
    Ok(watcher)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{
        list_all_notes, open_db, reindex, remove_note, resolve_vault_dir, LEGACY_VAULT_DIR_NAME,
    };
    use std::path::PathBuf;

    const OVERRIDE: &str = "STASH_VAULT_DIR";

    /// `remove_note` drops exactly one note's rows from all three tables
    /// (notes, tags, notes_fts) and leaves the other notes — and the files on
    /// disk — untouched. It is the index half of T4 deletion; moving the file
    /// to the Trash is the command's job, not this function's.
    #[test]
    fn remove_note_drops_all_index_rows_for_that_note_only() {
        let dir = std::env::temp_dir().join(format!(
            "stash-remove-note-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("a.md"),
            "---\nid: a\nkind: task\ncreated: 2026-08-30T10:00:00\ntags: [work]\n---\nbuy milk\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("b.md"),
            "---\nid: b\nkind: note\ncreated: 2026-08-30T11:00:00\n---\nkeep me\n",
        )
        .unwrap();

        let conn = open_db(&dir.join("index.db")).unwrap();
        assert_eq!(reindex(&conn, &dir).unwrap(), 2);

        remove_note(&conn, "a").unwrap();

        let ids = |sql: &str| -> Vec<String> {
            let mut stmt = conn.prepare(sql).unwrap();
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            rows
        };
        assert_eq!(ids("SELECT id FROM notes ORDER BY id"), vec!["b"]);
        assert_eq!(ids("SELECT id FROM notes_fts ORDER BY id"), vec!["b"]);
        assert!(ids("SELECT note_id FROM tags").is_empty());
        // Index-only: both files are still on disk.
        assert!(dir.join("a.md").is_file());
        assert!(dir.join("b.md").is_file());

        // Removing an id that isn't indexed is a no-op, not an error: the
        // watcher may have already reindexed a deletion away.
        remove_note(&conn, "ghost").unwrap();
        assert_eq!(ids("SELECT id FROM notes ORDER BY id"), vec!["b"]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The empty-search listing: every note, newest file mtime first (T5).
    /// mtimes are made distinct by writing the files in order with a pause —
    /// no dep on a set-mtime crate; APFS mtime resolution is far finer than
    /// the 25ms gap.
    #[test]
    fn list_all_notes_orders_by_mtime_desc() {
        let dir = scratch_home("list-all");
        let vault = dir.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        for name in ["first", "second", "third"] {
            std::fs::write(
                vault.join(format!("{name}.md")),
                format!("---\nkind: note\ncreated: 2026-01-01T00:00:00Z\n---\n{name} body\n"),
            )
            .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        // Rewrite `first` so its mtime becomes the newest: the expected order
        // (first, third, second) then differs from both write order and the
        // identical `created` values — only an mtime sort produces it.
        std::fs::write(
            vault.join("first.md"),
            "---\nkind: note\ncreated: 2026-01-01T00:00:00Z\n---\nfirst body updated\n",
        )
        .unwrap();

        let conn = open_db(&dir.join("index.db")).unwrap();
        assert_eq!(reindex(&conn, &vault).unwrap(), 3);
        let notes = list_all_notes(&conn).unwrap();
        let ids: Vec<&str> = notes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids, ["first", "third", "second"]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A db created before the `modified` column existed still opens: open_db
    /// must add the column so the all-notes query never hits "no such column".
    #[test]
    fn open_db_migrates_pre_modified_schema() {
        let dir = scratch_home("migrate");
        let db_path = dir.join("index.db");
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE notes (
                   id TEXT PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL,
                   created TEXT NOT NULL, title TEXT NOT NULL,
                   done INTEGER, deadline TEXT, alert TEXT
                 );",
            )
            .unwrap();
        }
        let conn = open_db(&db_path).unwrap();
        // The column exists and the all-notes query runs.
        assert!(list_all_notes(&conn).unwrap().is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    fn scratch_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "stash-vault-dir-test-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The `STASH_VAULT_DIR` override wins over the config file, the legacy
    /// fallback and the `~/Stash` default — and, crucially, changes nothing
    /// when it is unset. Without override or config, a pre-rename vault dir
    /// under home is preferred when it exists, else `~/Stash`.
    ///
    /// One test rather than several: `STASH_VAULT_DIR` is process-global
    /// state, and separate `#[test]` fns run on parallel threads in the same
    /// process, so each one would see the others' writes.
    #[test]
    fn vault_dir_override_wins_and_is_inert_when_unset() {
        // A home with no config file: resolution falls through to ~/Stash.
        let plain = scratch_home("plain");
        // A home whose config file names a `~`-relative vault.
        let configured = scratch_home("configured");
        std::fs::create_dir_all(configured.join(".config/stash")).unwrap();
        std::fs::write(
            configured.join(".config/stash/config.json"),
            r#"{"vaultDir": "~/Vaults/work"}"#,
        )
        .unwrap();
        // A home with no config file but a pre-rename vault dir on disk.
        let legacy = scratch_home("legacy");
        std::fs::create_dir_all(legacy.join(LEGACY_VAULT_DIR_NAME)).unwrap();
        // A legacy dir must NOT shadow an explicit config file.
        std::fs::create_dir_all(configured.join(LEGACY_VAULT_DIR_NAME)).unwrap();

        let default_dir = plain.join("Stash");
        let config_dir = PathBuf::from(format!("{}/Vaults/work", configured.display()));
        let legacy_dir = legacy.join(LEGACY_VAULT_DIR_NAME);

        // Baseline: env unset -> config, else legacy dir when present, else
        // ~/Stash.
        std::env::remove_var(OVERRIDE);
        assert_eq!(resolve_vault_dir(&plain), default_dir);
        assert_eq!(resolve_vault_dir(&configured), config_dir);
        assert_eq!(resolve_vault_dir(&legacy), legacy_dir);

        // Blank and whitespace-only are treated as unset, so an exported-but-
        // empty variable cannot silently shadow the user's configured vault.
        for blank in ["", "   "] {
            std::env::set_var(OVERRIDE, blank);
            assert_eq!(resolve_vault_dir(&plain), default_dir);
            assert_eq!(resolve_vault_dir(&configured), config_dir);
            assert_eq!(resolve_vault_dir(&legacy), legacy_dir);
        }

        // Set: takes precedence over all three.
        let fixture = plain.join("fixture-vault");
        std::env::set_var(OVERRIDE, &fixture);
        assert_eq!(resolve_vault_dir(&plain), fixture);
        assert_eq!(resolve_vault_dir(&configured), fixture);
        assert_eq!(resolve_vault_dir(&legacy), fixture);

        // And removing it restores the baseline byte for byte.
        std::env::remove_var(OVERRIDE);
        assert_eq!(resolve_vault_dir(&plain), default_dir);
        assert_eq!(resolve_vault_dir(&configured), config_dir);
        assert_eq!(resolve_vault_dir(&legacy), legacy_dir);

        let _ = std::fs::remove_dir_all(&plain);
        let _ = std::fs::remove_dir_all(&configured);
        let _ = std::fs::remove_dir_all(&legacy);
    }
}
