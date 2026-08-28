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
  alert    TEXT
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
        tx.execute(
            "INSERT OR REPLACE INTO notes (id, path, kind, created, title, done, deadline, alert)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                path.to_string_lossy(),
                kind,
                created,
                title,
                done,
                data.get("deadline"),
                data.get("alert"),
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

/// Full-text search over note bodies (FTS5) plus a LIKE fallback on titles.
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
         ORDER BY created DESC"
    ))?;
    let mut out = Vec::new();
    let mut q = stmt.query(params![fts_query, like])?;
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

/// `~/.config/notebook/config.json` `{ "vaultDir" }` if present, else
/// `<home>/Notebook`; a leading `~` expands to `home`.
pub fn resolve_vault_dir(home: &Path) -> PathBuf {
    let config = home.join(".config/notebook/config.json");
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
    home.join("Notebook")
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
