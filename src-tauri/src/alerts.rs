//! Alert scheduler: notes whose `alert` datetime has passed fire a macOS
//! notification, exactly once each.
//!
//! The "already fired" marker of record is `alerted: true` in the note's own
//! frontmatter, not a column in the index. The vault is the source of truth and
//! the index is a disposable cache — an index-only flag would be wiped by the
//! next `reindex` and every past alert would fire again. Selection reuses
//! `index::due_alerts` and then filters on the marker read straight from the
//! file; the due set is tiny, so the extra reads cost nothing.
//!
//! `take_due_alerts` is the whole decision, in plain Rust with no Tauri runtime
//! involved, so it is directly testable — see `tests/alert_scheduler.rs`.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::index::{self, NoteRow};
use crate::WriteError;

/// How often the resident scheduler re-checks for due alerts.
pub const POLL_INTERVAL_SECS: u64 = 30;

const MARKER_KEY: &str = "alerted";
const MARKER_LINE: &str = "alerted: true";

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/// Formats a Unix timestamp as `YYYY-MM-DDTHH:MM:SSZ` — the same fixed-width
/// UTC shape `parseDateTimeEntry` (src/lib/date-entry.ts) writes into `alert`,
/// so the `alert <= now` string compare in `due_alerts` is chronological.
pub fn iso_utc(unix_secs: i64) -> String {
    let (y, m, d) = civil_from_days(unix_secs.div_euclid(86_400));
    let secs = unix_secs.rem_euclid(86_400);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}

/// Current time in the same format. `SystemTime` is already UTC.
pub fn now_iso_utc() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    iso_utc(secs)
}

/// Days since 1970-01-01 -> (year, month, day). Howard Hinnant's
/// `civil_from_days`, the standard branch-free proleptic Gregorian conversion.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = yoe + era * 400;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ---------------------------------------------------------------------------
// The `alerted` marker (frontmatter, written in place)
// ---------------------------------------------------------------------------

/// The frontmatter block and the byte offset where it ends (i.e. where the
/// closing `\n---\n` begins). Mirrors the split in `index::parse_note_file`
/// and `src/lib/vault/frontmatter.ts`.
fn frontmatter_block(text: &str) -> Option<(&str, usize)> {
    let rest = text.strip_prefix("---\n")?;
    let end = rest.find("\n---\n")?;
    Some((&rest[..end], 4 + end))
}

fn is_marker_line(line: &str) -> bool {
    matches!(line.split_once(':'), Some((k, _)) if k.trim() == MARKER_KEY)
}

/// True when the note already carries `alerted: true`.
pub fn is_alerted(text: &str) -> bool {
    match frontmatter_block(text) {
        Some((block, _)) => block
            .lines()
            .any(|l| is_marker_line(l) && l.split_once(':').is_some_and(|(_, v)| v.trim() == "true")),
        None => false,
    }
}

/// Writes `alerted: true` into the note's frontmatter, preserving the rest of
/// the file byte for byte: the body after the closing `---` is re-emitted
/// verbatim and existing frontmatter lines keep their text and order. The
/// marker is appended as the block's last key line (or replaces an existing
/// `alerted:` line), which is exactly what the TS frontmatter serializer would
/// emit for an unknown key — so the file still round-trips there too.
///
/// The write is atomic *and* conditional: the exact bytes read here are the
/// precondition for the write (see [`mark_alerted_with`]). This is a background
/// job touching a file the user may be editing at the same moment, so unlike a
/// user-initiated save it must lose the race rather than win it.
pub fn mark_alerted(path: &Path) -> Result<(), WriteError> {
    let seen = std::fs::read(path)?;
    mark_alerted_with(path, &seen)
}

/// [`mark_alerted`] with the bytes the caller already read passed in — the same
/// marking path, with the read separated from the write so the compare-and-swap
/// window is the caller's to control (and so a test can widen it).
///
/// `seen` must be what the caller read from `path`. Immediately before the
/// rename, the target's current bytes are compared against it; if another writer
/// got there first, nothing is written and [`WriteError::Changed`] comes back
/// with the file byte-identical to what that writer left.
pub fn mark_alerted_with(path: &Path, seen: &[u8]) -> Result<(), WriteError> {
    let text = std::str::from_utf8(seen).map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("note is not utf-8: {} ({e})", path.display()),
        )
    })?;
    let Some((block, end)) = frontmatter_block(text) else {
        return Err(WriteError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("note has no frontmatter block: {}", path.display()),
        )));
    };
    let mut lines: Vec<&str> = block.lines().collect();
    match lines.iter().position(|l| is_marker_line(l)) {
        Some(i) if lines[i].trim() == MARKER_LINE => return Ok(()), // already marked
        Some(i) => lines[i] = MARKER_LINE,
        None => lines.push(MARKER_LINE),
    }
    // `&text[end..]` is the closing "\n---\n" plus the body, untouched.
    let marked = format!("---\n{}{}", lines.join("\n"), &text[end..]);
    crate::atomic_write(path, marked.as_bytes(), Some(seen))
}

// ---------------------------------------------------------------------------
// Selection (one scheduler pass)
// ---------------------------------------------------------------------------

/// A note whose alert has come due and that has just been marked alerted.
#[derive(Debug, Clone)]
pub struct PendingAlert {
    pub id: String,
    /// First non-empty body line (may be empty).
    pub title: String,
    pub path: String,
}

/// One scheduler pass: notes due at `now` (index query) that are not already
/// marked alerted, marked alerted and returned for the caller to notify about.
/// Calling it again with the same `now` returns nothing — the marker is on
/// disk before the note is handed back, so a crash between the two can only
/// lose a notification, never repeat one.
///
/// `now` must be `YYYY-MM-DDTHH:MM:SSZ` (see `now_iso_utc`).
pub fn take_due_alerts(conn: &Connection, now: &str) -> Vec<PendingAlert> {
    let due: Vec<NoteRow> = match index::due_alerts(conn, now) {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("alerts: due_alerts query failed: {e}");
            return Vec::new();
        }
    };

    let mut fired = Vec::new();
    for row in due {
        let path = Path::new(&row.path);
        match std::fs::read_to_string(path) {
            Ok(text) if is_alerted(&text) => continue, // already fired
            Ok(_) => {}
            Err(e) => {
                eprintln!("alerts: cannot read {}: {e}", row.path);
                continue;
            }
        }
        // Never notify about a note we failed to mark: it would fire again on
        // every pass from here on. A refused precondition is the same deal —
        // someone else was writing the file, so skip this pass and try again on
        // the next poll, having fired nothing.
        match mark_alerted(path) {
            Ok(()) => {}
            Err(WriteError::Changed) => {
                eprintln!(
                    "alerts: {} changed while marking; retrying next pass",
                    row.path
                );
                continue;
            }
            Err(e) => {
                eprintln!("alerts: cannot mark {} alerted: {e}", row.path);
                continue;
            }
        }
        fired.push(PendingAlert {
            id: row.id,
            title: row.title,
            path: row.path,
        });
    }
    fired
}
