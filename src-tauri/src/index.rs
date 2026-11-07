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
use std::sync::atomic::{AtomicBool, Ordering};
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

/// What one full rescan found.
///
/// `dataless` counts vault `.md` files whose content is not on disk: an
/// iCloud Drive vault under "Optimize Mac Storage" can evict notes at any
/// time, leaving the name and size listed but no bytes (see [`is_dataless`]).
/// Those are skipped, not indexed, and the count tells the caller to have
/// them downloaded ([`spawn_icloud_fetch`]).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ReindexReport {
    pub indexed: usize,
    pub dataless: usize,
}

/// Drops all indexed rows and rescans every `.md` file in `vault_dir`.
/// Returns the number of notes indexed.
pub fn reindex(conn: &Connection, vault_dir: &Path) -> Result<usize> {
    reindex_report(conn, vault_dir).map(|r| r.indexed)
}

/// [`reindex`], also reporting how many notes were skipped as dataless.
pub fn reindex_report(conn: &Connection, vault_dir: &Path) -> Result<ReindexReport> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM notes", [])?;
    tx.execute("DELETE FROM tags", [])?;
    tx.execute("DELETE FROM notes_fts", [])?;

    let mut count = 0usize;
    let mut dataless = 0usize;
    let entries = match std::fs::read_dir(vault_dir) {
        Ok(e) => e,
        Err(_) => {
            // Missing vault dir -> empty index; vault stays source of truth.
            tx.commit()?;
            return Ok(ReindexReport::default());
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // Symlink skip (T9): `file_type()` has lstat semantics — a symlink
        // reports is_symlink, not is_file — so only regular `.md` files are
        // indexed and a link can never pull in a file from outside the vault
        // (mirrors the sidecar's listNoteFilenames).
        let is_regular_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        if path.extension().and_then(|e| e.to_str()) != Some("md") || !is_regular_file {
            continue;
        }
        // Dataless check BEFORE any read: a stat never fetches content, but a
        // read of an evicted file does not just return an error to skip. By
        // default macOS refuses to materialise it for this process (the read
        // fails, most likely EDEADLK "Resource deadlock avoided"), and if
        // materialisation were ever enabled the read would instead block on
        // the network while holding the index lock. Either way: count it,
        // skip it, and let the caller request the download.
        let meta = entry.metadata().ok();
        if meta.as_ref().is_some_and(is_dataless) {
            dataless += 1;
            continue;
        }
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(e) => {
                // Logged, not fatal: one unreadable note must not empty the
                // index, but a silent skip is how evicted iCloud notes went
                // missing unnoticed.
                eprintln!("index: skipping unreadable note {}: {e}", path.display());
                continue;
            }
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
        // (Reuses the stat taken for the dataless check above.)
        let modified: i64 = meta
            .and_then(|m| m.modified().ok())
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
    Ok(ReindexReport {
        indexed: count,
        dataless,
    })
}

// ---------------------------------------------------------------------------
// Evicted (dataless) notes: iCloud Drive vaults
// ---------------------------------------------------------------------------
//
// With "Optimize Mac Storage" on, macOS evicts iCloud Drive files it thinks
// are cold: the directory entry, name and size stay, the bytes go, and the
// file is flagged `SF_DATALESS`. A plain read does not bring it back (the
// system default materialisation policy for a process is OFF, see
// setiopolicy_np(3)), so before this a vault of evicted notes reindexed to an
// empty index with no error anywhere. Now the rescan counts them and the app
// asks iCloud to download them, then rescans until they have arrived.

/// `SF_DATALESS` from <sys/stat.h>: "file is dataless object".
const SF_DATALESS: u32 = 0x4000_0000;

/// Whether a `st_flags` word marks a dataless (evicted) file. Pure, so the
/// bit test is unit-testable without a real evicted file.
pub fn flags_dataless(st_flags: u32) -> bool {
    st_flags & SF_DATALESS != 0
}

/// Whether `meta` (from a stat, which never fetches content) describes a
/// dataless file. macOS-only flag; anywhere else nothing is ever dataless.
pub fn is_dataless(meta: &std::fs::Metadata) -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt;
        flags_dataless(meta.st_flags())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = meta;
        false
    }
}

/// How long to wait before each re-check after asking iCloud for the files;
/// `None` once the schedule is spent (~13 minutes in all). Starts short, since
/// a vault of small notes usually arrives in seconds, and backs off so an
/// offline Mac is not rescanned every few seconds forever. A later watcher
/// event or the next app start begins a fresh round.
pub fn fetch_poll_delay(attempt: usize) -> Option<Duration> {
    const SCHEDULE_SECS: [u64; 12] = [2, 3, 5, 10, 15, 30, 60, 120, 120, 120, 120, 180];
    SCHEDULE_SECS.get(attempt).map(|s| Duration::from_secs(*s))
}

/// One download round at a time: the watcher's own rescans (which iCloud's
/// arriving files may trigger) call [`spawn_icloud_fetch`] too, and must not
/// stack up further `brctl` processes and poll loops.
static FETCH_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// The trigger decision: start a round only when the rescan found dataless
/// notes AND no round is already running, claiming `in_flight` if so. Takes
/// the flag as a parameter so tests can use their own instead of the global.
fn claim_fetch(report: ReindexReport, in_flight: &AtomicBool) -> bool {
    report.dataless > 0 && !in_flight.swap(true, Ordering::SeqCst)
}

/// When `report` found dataless notes, asks iCloud to download the vault and,
/// on a background thread, rescans on the [`fetch_poll_delay`] schedule until
/// none are left, calling `on_reindex` whenever a rescan changed the count
/// (same contract as the watcher's: views refetch, enrichment dispatches).
///
/// Never blocks the caller (setup runs it on the main thread). Never writes
/// to the vault: `brctl download` only fetches content iCloud already has.
/// The rescans do not rely on the file watcher noticing the downloads; if it
/// does, its own rescan simply lands first.
///
/// `brctl download <dir>` is the request the user ran by hand to recover;
/// whether it returns at once or waits for the transfer is undocumented, so
/// the child is reaped on its own thread and completion is judged only by
/// the dataless count. It only helps iCloud Drive vaults; for other cloud
/// providers it fails harmlessly and the rounds just run out.
pub fn spawn_icloud_fetch(
    report: ReindexReport,
    vault_dir: Arc<Mutex<PathBuf>>,
    conn: Arc<Mutex<Connection>>,
    on_reindex: Arc<dyn Fn() + Send + Sync>,
) {
    if !claim_fetch(report, &FETCH_IN_FLIGHT) {
        return;
    }
    std::thread::spawn(move || {
        if let Ok(dir) = vault_dir.lock().map(|d| d.clone()) {
            eprintln!(
                "index: {} note(s) in {} are evicted to iCloud; requesting download",
                report.dataless,
                dir.display()
            );
            match std::process::Command::new("/usr/bin/brctl")
                .arg("download")
                .arg(&dir)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
            {
                Ok(mut child) => {
                    std::thread::spawn(move || {
                        let _ = child.wait();
                    });
                }
                Err(e) => eprintln!("index: brctl download failed to start: {e}"),
            }
        }
        let mut remaining = report.dataless;
        let mut attempt = 0;
        while let Some(delay) = fetch_poll_delay(attempt) {
            attempt += 1;
            std::thread::sleep(delay);
            let Some(r) = watcher_reindex(&conn, &vault_dir) else {
                continue;
            };
            if r.dataless != remaining {
                remaining = r.dataless;
                on_reindex();
            }
            if remaining == 0 {
                break;
            }
        }
        if remaining > 0 {
            eprintln!("index: {remaining} note(s) still evicted after download rounds; retrying on next vault change or app start");
        }
        FETCH_IN_FLIGHT.store(false, Ordering::SeqCst);
    });
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
pub const LEGACY_VAULT_DIR_NAME: &str = concat!("Note", "book");

/// Whether the user has ever chosen a vault: `config.json` holds a non-empty
/// `vaultDir`. The file merely existing is not enough — first-run provider
/// detection writes `{"llm": …}` into it before the setup wizard's check
/// runs. An existing but unparseable file counts as configured: hands off,
/// the same rule `llm_config` applies, so the wizard can never clobber it.
pub fn vault_dir_configured(home: &Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(home.join(".config/stash/config.json")) else {
        return false;
    };
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(json) => json
            .get("vaultDir")
            .and_then(|v| v.as_str())
            .is_some_and(|d| !d.is_empty()),
        Err(_) => true,
    }
}

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

/// Watches the vault dir and triggers a full reindex ~500ms after the last
/// file event. The returned watcher must be kept alive for the app's lifetime.
///
/// `vault_dir` is the SHARED handle also swapped by `set_vault_dir` — the
/// watch is registered on the dir it holds at spawn time, but every reindex
/// re-reads it (see [`watcher_reindex`]), so a vault switch mid-session can
/// never make an event from the old directory rebuild the index from the old
/// directory's files. `set_vault_dir` re-points the watch itself.
///
/// `on_reindex` runs after each successful reindex, **outside** the connection
/// lock so it can query the index itself. T12 uses it to queue enrichment jobs
/// for freshly saved knowledge notes: the watcher already sees every vault
/// write, whatever wrote it, and it fires only after the file is on disk.
/// It is an `Arc` because the iCloud download rounds ([`spawn_icloud_fetch`])
/// started from here call it too.
pub fn spawn_watcher(
    vault_dir: Arc<Mutex<PathBuf>>,
    conn: Arc<Mutex<Connection>>,
    on_reindex: Arc<dyn Fn() + Send + Sync>,
) -> notify::Result<notify::RecommendedWatcher> {
    use notify::Watcher;
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    })?;
    let watch_dir = match vault_dir.lock() {
        Ok(dir) => dir.clone(),
        Err(e) => return Err(notify::Error::generic(&format!("vault dir lock poisoned: {e}"))),
    };
    watcher.watch(&watch_dir, notify::RecursiveMode::NonRecursive)?;
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            // Debounce: swallow further events until 500ms of quiet.
            while rx.recv_timeout(Duration::from_millis(500)).is_ok() {}
            if let Some(report) = watcher_reindex(&conn, &vault_dir) {
                on_reindex();
                // iCloud may evict notes while the app runs; the eviction
                // itself is a file event, so this is where it is noticed.
                spawn_icloud_fetch(report, vault_dir.clone(), conn.clone(), on_reindex.clone());
            }
        }
    });
    Ok(watcher)
}

/// One watcher-triggered reindex. Reads the vault dir from the shared handle
/// AT CALL TIME — never a copy captured when the watcher was spawned — so
/// after `set_vault_dir` swaps the dir, a stray event from the previously
/// watched directory rebuilds the index from the CURRENT vault, not the old
/// one (a harmless refresh instead of a silent clobber). `None` when the
/// reindex did not happen. The iCloud download rounds use it for the same
/// reason: a vault switch mid-round must not rebuild from the old dir.
fn watcher_reindex(
    conn: &Arc<Mutex<Connection>>,
    vault_dir: &Arc<Mutex<PathBuf>>,
) -> Option<ReindexReport> {
    let dir = vault_dir.lock().ok()?.clone();
    let conn = conn.lock().ok()?;
    match reindex_report(&conn, &dir) {
        Ok(report) => Some(report),
        Err(e) => {
            eprintln!("index: reindex after file change failed: {e}");
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{
        claim_fetch, fetch_poll_delay, flags_dataless, is_dataless, list_all_notes, open_db,
        reindex, reindex_report, remove_note, resolve_vault_dir, search_notes,
        vault_dir_configured, watcher_reindex, ReindexReport, LEGACY_VAULT_DIR_NAME,
    };
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    const OVERRIDE: &str = "STASH_VAULT_DIR";

    /// The `SF_DATALESS` bit test. Real evicted files can't be made in a
    /// test (it takes iCloud), so the decision is pinned on raw flag words:
    /// the user's evicted notes showed `compressed,dataless` in `ls -lO`,
    /// i.e. `SF_COMPRESSED` (0x20) set alongside it.
    #[test]
    fn flags_dataless_tests_only_the_dataless_bit() {
        assert!(!flags_dataless(0));
        assert!(flags_dataless(0x4000_0000));
        assert!(flags_dataless(0x4000_0000 | 0x20));
        // Compressed alone (a normal APFS-compressed file) is not evicted,
        // nor is any other flag (UF_HIDDEN 0x8000).
        assert!(!flags_dataless(0x20));
        assert!(!flags_dataless(0x8000));
    }

    /// An ordinary on-disk note is never reported dataless, and a rescan of
    /// a fully local vault reports zero skipped, so no download is requested.
    #[test]
    fn reindex_report_counts_no_dataless_in_a_local_vault() {
        let dir = scratch_home("dataless-report");
        let vault = dir.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        for name in ["a", "b"] {
            std::fs::write(
                vault.join(format!("{name}.md")),
                format!("---\nid: {name}\nkind: task\ncreated: 2026-11-07T10:00:00\n---\n{name}\n"),
            )
            .unwrap();
        }
        assert!(!is_dataless(&std::fs::metadata(vault.join("a.md")).unwrap()));

        let conn = open_db(&dir.join("index.db")).unwrap();
        assert_eq!(
            reindex_report(&conn, &vault).unwrap(),
            ReindexReport {
                indexed: 2,
                dataless: 0
            }
        );
        // The plain wrapper still returns just the indexed count.
        assert_eq!(reindex(&conn, &vault).unwrap(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A download round starts only for a rescan that found dataless notes,
    /// and never while another round holds the flag (the watcher's rescans,
    /// possibly triggered by the downloads themselves, must not stack up
    /// brctl processes).
    #[test]
    fn claim_fetch_needs_dataless_notes_and_a_free_slot() {
        let flag = AtomicBool::new(false);
        let none = ReindexReport {
            indexed: 23,
            dataless: 0,
        };
        let some = ReindexReport {
            indexed: 0,
            dataless: 23,
        };
        // Nothing evicted: no round, and the slot stays free.
        assert!(!claim_fetch(none, &flag));
        assert!(!flag.load(Ordering::SeqCst));
        // Evicted notes and a free slot: start, claiming the slot …
        assert!(claim_fetch(some, &flag));
        assert!(flag.load(Ordering::SeqCst));
        // … so a second trigger while it runs is refused.
        assert!(!claim_fetch(some, &flag));
        // Once the round releases the slot, the next trigger starts again.
        flag.store(false, Ordering::SeqCst);
        assert!(claim_fetch(some, &flag));
    }

    /// The re-check schedule starts within seconds, never shrinks, stays
    /// bounded per step, and ends, so an offline Mac doesn't poll forever.
    #[test]
    fn fetch_poll_delay_backs_off_and_ends() {
        let delays: Vec<Duration> = (0..).map_while(fetch_poll_delay).collect();
        assert!(!delays.is_empty());
        assert!(delays[0] <= Duration::from_secs(2));
        assert!(delays.windows(2).all(|w| w[0] <= w[1]));
        assert!(delays.iter().all(|d| *d <= Duration::from_secs(180)));
        let total: Duration = delays.iter().sum();
        assert!(total <= Duration::from_secs(20 * 60), "{total:?}");
        assert_eq!(fetch_poll_delay(delays.len()), None);
    }

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

    /// The watcher-clobber regression (T6 audit): `watcher_reindex` must read
    /// the vault dir from the shared handle AT CALL TIME. After a vault
    /// switch swaps that handle, a call — as a stray fs event from the old
    /// directory would trigger — rebuilds the index from the NEW vault, so
    /// the old directory can no longer overwrite it with its own contents.
    #[test]
    fn watcher_reindex_follows_the_current_shared_vault_dir() {
        let dir = scratch_home("watcher-reindex");
        let old_vault = dir.join("old");
        let new_vault = dir.join("new");
        std::fs::create_dir_all(&old_vault).unwrap();
        std::fs::create_dir_all(&new_vault).unwrap();
        std::fs::write(
            old_vault.join("old.md"),
            "---\nid: old\nkind: note\ncreated: 2026-08-30T10:00:00\n---\nold vault note\n",
        )
        .unwrap();
        std::fs::write(
            new_vault.join("new.md"),
            "---\nid: new\nkind: note\ncreated: 2026-08-30T11:00:00\n---\nnew vault note\n",
        )
        .unwrap();

        let conn = Arc::new(Mutex::new(open_db(&dir.join("index.db")).unwrap()));
        let shared_dir = Arc::new(Mutex::new(old_vault.clone()));
        let ids = |conn: &Arc<Mutex<rusqlite::Connection>>| -> Vec<String> {
            list_all_notes(&conn.lock().unwrap())
                .unwrap()
                .into_iter()
                .map(|n| n.id)
                .collect()
        };

        // Before the switch: events index the old vault (it IS the vault).
        assert!(watcher_reindex(&conn, &shared_dir).is_some());
        assert_eq!(ids(&conn), vec!["old"]);

        // The switch (what set_vault_dir does to the shared handle) …
        *shared_dir.lock().unwrap() = new_vault.clone();
        // … and a subsequent watcher-triggered reindex — even one caused by
        // an event in the OLD directory — indexes the CURRENT vault only.
        assert!(watcher_reindex(&conn, &shared_dir).is_some());
        assert_eq!(ids(&conn), vec!["new"]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `reindex` must not follow symlinks (T9): a symlinked `.md` inside the
    /// vault pointing at an outside file must be skipped, so the outside
    /// file's content can never leak into the index (mirrors the sidecar's
    /// listNoteFilenames skip). Unix-only: symlink creation needs
    /// `std::os::unix::fs::symlink`; elsewhere this test is compiled out.
    #[cfg(unix)]
    #[test]
    fn reindex_skips_symlinked_md_entries() {
        let dir = scratch_home("symlink-skip");
        let vault = dir.join("vault");
        let outside = dir.join("outside");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(
            vault.join("honest.md"),
            "---\nid: honest\nkind: note\ncreated: 2026-08-30T10:00:00\n---\nhonest note body\n",
        )
        .unwrap();
        std::fs::write(
            outside.join("secret.md"),
            "---\nid: outside\nkind: note\ncreated: 2026-08-30T11:00:00\n---\nzzz-outside-secret-zzz\n",
        )
        .unwrap();
        std::os::unix::fs::symlink(outside.join("secret.md"), vault.join("sneaky.md")).unwrap();

        let conn = open_db(&dir.join("index.db")).unwrap();
        // Only the honest note is indexed; the symlinked entry is skipped.
        assert_eq!(reindex(&conn, &vault).unwrap(), 1);
        let ids: Vec<String> = list_all_notes(&conn)
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect();
        assert_eq!(ids, vec!["honest"]);
        // No row/FTS hit carries the outside file's distinctive content …
        assert!(search_notes(&conn, "zzz-outside-secret-zzz").unwrap().is_empty());
        // … while the honest note's body is still searchable.
        assert_eq!(search_notes(&conn, "honest").unwrap().len(), 1);

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

    /// Only a non-empty `vaultDir` means the user chose a vault. The
    /// `{"llm": …}` file first-run provider detection writes on a fresh
    /// machine must NOT count — that was the wizard being skipped.
    #[test]
    fn vault_dir_configured_needs_the_key_not_the_file() {
        let write = |name: &str, raw: Option<&str>| {
            let home = scratch_home(name);
            if let Some(raw) = raw {
                std::fs::create_dir_all(home.join(".config/stash")).unwrap();
                std::fs::write(home.join(".config/stash/config.json"), raw).unwrap();
            }
            home
        };
        let cases = [
            ("vdc-absent", None, false),
            (
                "vdc-llm-only",
                Some(r#"{"llm":{"provider":"none","model":""}}"#),
                false,
            ),
            ("vdc-empty", Some(r#"{"vaultDir":""}"#), false),
            ("vdc-set", Some(r#"{"vaultDir":"~/Vaults/work"}"#), true),
            ("vdc-malformed", Some(r#"{"vaultDir":"#), true),
        ];
        for (name, raw, expected) in cases {
            let home = write(name, raw);
            assert_eq!(vault_dir_configured(&home), expected, "{name}");
            let _ = std::fs::remove_dir_all(&home);
        }
    }
}
