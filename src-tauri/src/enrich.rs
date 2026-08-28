//! Enrichment job selection (T12).
//!
//! This module only decides *which* knowledge notes still need an enrichment
//! pass and what their plausible link targets are. The model call and the file
//! write happen in the Node sidecar (`sidecar/src/enrich.ts`), which is the
//! only side that touches note bytes.
//!
//! Two deliberate choices:
//!
//! * The `enriched` frontmatter timestamp is the idempotence marker and it is
//!   read from the **vault file**, not from an index column. The index is a
//!   disposable cache; a marker that survives a db wipe is what makes the
//!   "retry on next app start" behaviour correct. A failed job writes nothing,
//!   so it leaves no marker and is re-selected next time.
//! * Related candidates come from the SQLite FTS index here, in Rust, and ride
//!   along in the job payload — the sidecar never opens the db.
//!
//! Selection re-reads every knowledge note on each pass. The vault is small
//! (same assumption as the full-rescan reindex) and this keeps the marker in
//! exactly one place.

use crate::index::{self, parse_note_file};
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// How many candidate related notes are handed to the enrichment prompt. The
/// model picks from these; the sidecar caps the links it actually keeps at 3.
pub const MAX_CANDIDATES: usize = 8;

/// Title words that carry no signal for finding related notes.
const STOPWORDS: &[&str] = &[
    "about", "after", "again", "been", "being", "from", "have", "here", "http", "https", "into",
    "just", "like", "more", "note", "notes", "over", "some", "than", "that", "them", "then",
    "there", "these", "they", "this", "very", "were", "what", "when", "will", "with", "would",
    "your",
];

/// An existing note offered to the prompt as a possible `[[wiki-link]]` target.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RelatedNote {
    pub id: String,
    pub title: String,
}

/// One queued enrichment job.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EnrichJob {
    pub id: String,
    pub path: String,
    pub related: Vec<RelatedNote>,
}

/// Search terms from a note title: alphanumeric runs of 4+ chars, stopwords
/// dropped, deduped, capped at 6.
fn keywords(title: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for word in title.to_lowercase().split(|c: char| !c.is_alphanumeric()) {
        if word.len() < 4 || STOPWORDS.contains(&word) || out.iter().any(|w| w == word) {
            continue;
        }
        out.push(word.to_string());
        if out.len() == 6 {
            break;
        }
    }
    out
}

/// FTS hits for each title keyword, self excluded, deduped in hit order,
/// capped at [`MAX_CANDIDATES`]. `search_notes` ANDs its tokens, so each
/// keyword is searched separately to get OR-ish behaviour.
fn related_candidates(
    conn: &Connection,
    note_id: &str,
    title: &str,
) -> index::Result<Vec<RelatedNote>> {
    let mut out: Vec<RelatedNote> = Vec::new();
    for keyword in keywords(title) {
        for hit in index::search_notes(conn, &keyword)? {
            if hit.id == note_id || out.iter().any(|r| r.id == hit.id) {
                continue;
            }
            out.push(RelatedNote {
                id: hit.id,
                title: hit.title,
            });
            if out.len() == MAX_CANDIDATES {
                return Ok(out);
            }
        }
    }
    Ok(out)
}

/// True when the note file already carries a non-empty `enriched` value.
/// A file we cannot read counts as enriched: skipping it is safer than
/// queueing a job that would fail on every pass.
fn already_enriched(path: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else {
        return true;
    };
    let (data, _tags, _body) = parse_note_file(&text);
    data.get("enriched").is_some_and(|v| !v.is_empty())
}

/// Every indexed `kind: knowledge` note that has no `enriched` marker yet,
/// each with its candidate link targets.
///
/// Called after the reindex at app start (the retry pass) and after every
/// watcher-triggered reindex (the on-save path).
pub fn pending_jobs(conn: &Connection, vault_dir: &Path) -> index::Result<Vec<EnrichJob>> {
    let mut stmt = conn
        .prepare("SELECT id, path, title FROM notes WHERE kind = 'knowledge' ORDER BY created")?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<index::Result<Vec<_>>>()?;

    let mut jobs = Vec::new();
    for (id, path, title) in rows {
        // The sidecar writes to this path; never hand it one outside the vault.
        if !PathBuf::from(&path).starts_with(vault_dir) {
            continue;
        }
        if already_enriched(Path::new(&path)) {
            continue;
        }
        let related = related_candidates(conn, &id, &title)?;
        jobs.push(EnrichJob { id, path, related });
    }
    Ok(jobs)
}
