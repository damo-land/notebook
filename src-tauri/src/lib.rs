pub mod alerts;
pub mod enrich;
pub mod index;

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, State,
};
use tauri_nspanel::{tauri_panel, ManagerExt, WebviewWindowExt};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

/// Global shortcut that toggles overlay visibility.
/// T8 registers additional shortcuts alongside this one.
pub const TOGGLE_OVERLAY_SHORTCUT: &str = "alt+space";

/// Global shortcut that opens the overlay directly in the tasks view (T8).
/// Shows the panel and emits `open-tasks-view` to the frontend.
pub const TASKS_VIEW_SHORTCUT: &str = "alt+shift+space";

const OVERLAY_WINDOW_LABEL: &str = "main";

tauri_panel! {
    panel!(OverlayPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

fn toggle_overlay(app: &AppHandle) {
    if let Ok(panel) = app.get_webview_panel(OVERLAY_WINDOW_LABEL) {
        if panel.is_visible() {
            panel.hide();
        } else {
            panel.show_and_make_key();
        }
    }
}

/// Tasks-view shortcut: always show (never toggle-hide) and tell the
/// frontend to switch to the tasks view.
fn open_tasks_view(app: &AppHandle) {
    if let Ok(panel) = app.get_webview_panel(OVERLAY_WINDOW_LABEL) {
        panel.show_and_make_key();
    }
    use tauri::Emitter;
    if let Err(e) = app.emit("open-tasks-view", ()) {
        eprintln!("emit open-tasks-view: {e}");
    }
}

/// Invoked from the frontend keymap (Esc / Ctrl+W) to hide the overlay.
#[tauri::command]
fn hide_overlay(app: AppHandle) {
    if let Ok(panel) = app.get_webview_panel(OVERLAY_WINDOW_LABEL) {
        panel.hide();
    }
}

// --- Dev-only screenshot hook (scripts/shoot.sh) -----------------------------
//
// The overlay is only reachable through a global hotkey, and synthesising one
// from a script needs macOS Accessibility permission that an unattended run
// cannot grant. So `scripts/shoot.sh` launches a debug build with
// `NOTEBOOK_SHOOT_VIEW=<capture|tasks|search|chat|editor>` instead: the
// frontend asks for the value on mount (`shoot_view`), switches to that view,
// and only once it has painted asks for the panel (`shoot_show_overlay`).
// Showing last is what lets the harness treat "the panel is on screen" as a
// true readiness signal rather than guessing a settle delay.
//
// Both commands are inert unless the variable is set AND this is a debug
// build, so nothing here can show the overlay in a release build.

/// The requested screenshot view, or `None` in a release build / a normal run.
fn shoot_view_env() -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var("NOTEBOOK_SHOOT_VIEW")
        .ok()
        .filter(|v| !v.trim().is_empty())
}

#[tauri::command]
fn shoot_view() -> Option<String> {
    let view = shoot_view_env();
    if let Some(view) = &view {
        eprintln!("[shoot] frontend asked for the view: {view}");
    }
    view
}

#[tauri::command]
fn shoot_show_overlay(app: AppHandle) {
    if shoot_view_env().is_none() {
        return;
    }
    // `show_and_make_key` is `orderFrontRegardless` + `makeKeyWindow`, and
    // AppKit ignores those from a background thread — which is where Tauri
    // runs command handlers. The global-shortcut path is already on the main
    // thread; this one has to hop there, or the panel silently never appears.
    let handle = app.clone();
    let hopped = app.run_on_main_thread(move || {
        // The dev log is all the harness can read when the panel never shows.
        eprintln!("[shoot] showing the overlay panel");
        match handle.get_webview_panel(OVERLAY_WINDOW_LABEL) {
            Ok(panel) => panel.show_and_make_key(),
            Err(e) => eprintln!("[shoot] overlay panel not available: {e:?}"),
        }
    });
    if let Err(e) = hopped {
        eprintln!("[shoot] could not reach the main thread: {e}");
    }
}

/// Resident alert scheduler (T9): fires a macOS notification for every note
/// whose `alert` datetime has passed and that isn't yet marked alerted.
///
/// The first pass runs immediately — that is the catch-up for alerts that came
/// due while the app was closed — and then every `POLL_INTERVAL_SECS`. It must
/// be spawned AFTER the initial `reindex`, or the catch-up pass would query an
/// empty index. `take_due_alerts` marks each note on disk before returning it,
/// so nothing fires twice.
fn spawn_alert_scheduler(app: AppHandle, conn: Arc<Mutex<rusqlite::Connection>>) {
    use tauri_plugin_notification::NotificationExt;
    std::thread::spawn(move || loop {
        let now = alerts::now_iso_utc();
        let due = match conn.lock() {
            Ok(conn) => alerts::take_due_alerts(&conn, &now),
            Err(e) => {
                eprintln!("alerts: index lock poisoned: {e}");
                Vec::new()
            }
        };
        for note in due {
            let body = if note.title.trim().is_empty() {
                note.id.clone()
            } else {
                note.title.clone()
            };
            if let Err(e) = app
                .notification()
                .builder()
                .title("Notebook reminder")
                .body(body)
                .show()
            {
                eprintln!("alerts: notification failed for {}: {e}", note.id);
            }
        }
        std::thread::sleep(Duration::from_secs(alerts::POLL_INTERVAL_SECS));
    });
}

/// SQLite index state. The watcher handle is held here to keep it alive.
struct IndexState {
    conn: Arc<Mutex<rusqlite::Connection>>,
    vault_dir: PathBuf,
    _watcher: Option<notify::RecommendedWatcher>,
}

#[tauri::command]
fn search_notes(state: State<IndexState>, text: String) -> Result<Vec<index::NoteRow>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    index::search_notes(&conn, &text).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_tasks(
    state: State<IndexState>,
    category: Option<String>,
) -> Result<Vec<index::NoteRow>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    index::list_tasks(&conn, category.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn due_alerts(state: State<IndexState>, now: String) -> Result<Vec<index::NoteRow>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    index::due_alerts(&conn, &now).map_err(|e| e.to_string())
}

/// Full rebuild: rescans the vault into the db. Returns the note count.
#[tauri::command]
fn reindex(state: State<IndexState>) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    index::reindex(&conn, &state.vault_dir).map_err(|e| e.to_string())
}

// --- Durable note writes -----------------------------------------------------
//
// Every write to a note in the user's vault goes through `atomic_write`. A
// plain `fs::write` truncates the file and then refills it: a crash in between
// leaves one of the user's real notes half written, and the vault is the source
// of truth for this app — there is nothing to restore it from.
//
// Both note-write sites in this crate use it: `vault_write_file` below (the
// command every frontend save funnels through) and `alerts::mark_alerted`.

/// Serial number for staging file names, so two writes from this process can
/// never pick the same temp path.
static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Why a write through [`atomic_write`] did not happen.
///
/// `Changed` is deliberately *not* an I/O failure: it means the caller's
/// compare-and-swap precondition did not hold, nothing was written, and the
/// target is byte-identical to what the other writer left there. Callers that
/// need to tell the two apart (see `alerts::take_due_alerts`) match on it.
#[derive(Debug)]
pub enum WriteError {
    /// The target no longer holds the bytes the caller read.
    Changed,
    Io(std::io::Error),
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // I/O failures render exactly as the underlying `io::Error` did
            // before, so error strings built from this keep their old shape.
            WriteError::Io(e) => write!(f, "{e}"),
            WriteError::Changed => write!(f, "file changed on disk since it was read"),
        }
    }
}

impl From<std::io::Error> for WriteError {
    fn from(e: std::io::Error) -> Self {
        WriteError::Io(e)
    }
}

/// The file [`atomic_write`] stages `path`'s new contents in before renaming it
/// over the target.
///
/// It is always a *sibling* of the target — `with_file_name`, so this holds
/// even for a bare relative filename. That placement is the whole trick:
/// `rename(2)` is only atomic within one filesystem, so staging in `/tmp` or in
/// the app data dir would be a cross-device rename that either fails outright
/// or degrades into a non-atomic copy.
///
/// The name is hidden, unique per process and per call, and never ends in
/// `.md`: the vault indexer scans `*.md`, and a temp that matched would trigger
/// a spurious reindex even for the moment it exists.
pub fn temp_path_for(path: &Path) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    path.with_file_name(format!(
        ".notebook-{}-{nanos}-{seq}.tmp",
        std::process::id()
    ))
}

/// Writes `data` to `path` so that a concurrent reader — or a reader after a
/// crash — sees either the complete old file or the complete new one.
///
/// `expect` makes the write a compare-and-swap: when it is `Some(bytes)`, the
/// target's current contents are re-read immediately before the rename and must
/// still equal `bytes`, otherwise nothing is written and [`WriteError::Changed`]
/// comes back. A re-read that *fails* counts as changed too: the bytes cannot be
/// confirmed, so they must not be overwritten. `None` always overwrites.
///
/// (The compare and the rename are two syscalls, so this is a narrow-window CAS,
/// not a lock. It closes the window that matters here — a whole read, edit and
/// write-back cycle — not the microseconds between the two.)
pub fn atomic_write(path: &Path, data: &[u8], expect: Option<&[u8]>) -> Result<(), WriteError> {
    let tmp = temp_path_for(path);

    if let Err(e) = stage(&tmp, data) {
        let _ = std::fs::remove_file(&tmp);
        return Err(WriteError::Io(e));
    }
    if let Some(expected) = expect {
        if !matches!(std::fs::read(path), Ok(current) if current == expected) {
            let _ = std::fs::remove_file(&tmp);
            return Err(WriteError::Changed);
        }
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(WriteError::Io(e));
    }
    Ok(())
}

/// Fills the staging file. `sync_all` before the rename is what makes the
/// rename worth anything: renaming a file whose bytes are still in the page
/// cache would survive a process crash but not a power cut.
fn stage(tmp: &Path, data: &[u8]) -> std::io::Result<()> {
    let mut file = std::fs::File::create(tmp)?;
    file.write_all(data)?;
    file.sync_all()
}

// Minimal filesystem bridge for the TS vault library (src/lib/vault): the
// frontend's VaultFs is implemented over these commands. Plain std::fs; the
// path clamp that keeps notes inside the vault lives in TS (notePath).

#[tauri::command]
fn vault_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

/// Atomic, but with **no** precondition: the user is the authority for their
/// own saves. Refusing a write because a background job touched the note in the
/// meantime would lose what they just typed.
#[tauri::command]
fn vault_write_file(path: String, data: String) -> Result<(), String> {
    atomic_write(Path::new(&path), data.as_bytes(), None)
        .map_err(|e| format!("write {path}: {e}"))
}

#[tauri::command]
fn vault_readdir(path: String) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| format!("readdir {path}: {e}"))?;
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("readdir {path}: {e}"))?;
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    Ok(names)
}

#[tauri::command]
fn vault_mkdir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("mkdir {path}: {e}"))
}

#[tauri::command]
fn home_dir() -> Result<String, String> {
    std::env::var("HOME").map_err(|e| format!("HOME: {e}"))
}

// --- Sidecar (Node agent process, see sidecar/README.md) ---------------------
//
// Spawned on app setup, killed on app exit. Line-delimited JSON over stdio:
// we write {id, method, params?}\n to its stdin and read {id, ok, ...}\n lines
// from its stdout.
//
// Responses are routed back to callers **by id**: a `sidecar_ping` from the UI
// and a minutes-long `enrich` job run concurrently, and whichever reply lands
// first must not be handed to the wrong waiter.

struct SidecarProc {
    child: Child,
    stdin: ChildStdin,
    next_id: u64,
}

#[derive(Default)]
struct Sidecar {
    proc: Mutex<Option<SidecarProc>>,
    /// Request id -> where its response line goes. Filled by `call`, drained
    /// by the stdout reader thread.
    pending: Mutex<HashMap<u64, mpsc::Sender<String>>>,
}

impl Sidecar {
    /// Writes one request line and returns the receiver for its response.
    /// The process lock is released before returning, so the caller can wait
    /// as long as it likes without blocking other callers.
    fn call(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<mpsc::Receiver<String>, String> {
        let mut guard = self.proc.lock().map_err(|_| "sidecar state poisoned")?;
        let proc = guard.as_mut().ok_or("sidecar not running")?;
        proc.next_id += 1;
        let id = proc.next_id;

        let mut req = serde_json::json!({ "id": id, "method": method });
        if let Some(params) = params {
            req["params"] = params;
        }

        // Register before writing: a fast reply must never arrive unrouted.
        let (tx, rx) = mpsc::channel::<String>();
        self.pending
            .lock()
            .map_err(|_| "sidecar pending map poisoned")?
            .insert(id, tx);

        let line = format!("{req}\n");
        if let Err(e) = proc
            .stdin
            .write_all(line.as_bytes())
            .and_then(|_| proc.stdin.flush())
        {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&id);
            }
            return Err(format!("write to sidecar: {e}"));
        }
        Ok(rx)
    }
}

#[derive(Default)]
struct SidecarState(Arc<Sidecar>);

/// Dev wiring: the sidecar lives next to src-tauri in the repo.
fn sidecar_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../sidecar")
}

fn spawn_sidecar() -> Result<(Child, ChildStdin, ChildStdout), String> {
    let mut cmd = Command::new("node");
    cmd.args(["--import", "tsx", "src/main.ts"])
        .current_dir(sidecar_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    // Auth is Claude Code OAuth only; make sure a stray API key in the app's
    // environment can never reach the SDK (billing stays on subscription).
    cmd.env_remove("ANTHROPIC_API_KEY");

    let mut child = cmd.spawn().map_err(|e| format!("spawn sidecar: {e}"))?;
    let stdin = child.stdin.take().ok_or("sidecar stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("sidecar stdout unavailable")?;
    Ok((child, stdin, stdout))
}

/// Reads sidecar output lines and routes each one.
///
/// Two kinds of line arrive here:
///
///   * `{"type":"chunk", id, turn, text}` — an unsolicited streaming delta from
///     a `chat` call. Forwarded to the frontend as a `chat-chunk` Tauri event
///     and NOT looked up in the pending map. The order matters: a chunk line
///     carries the request id too, so checking `type` after the map lookup
///     would hand the waiter its first delta and close the request early.
///   * `{id, ok, ...}` — the one real response, which closes the request.
///
/// Nothing in here may kill the thread: a malformed line just fails the
/// `serde_json` parse, falls through the chunk check, matches no waiter and is
/// logged — leaving ping and enrich routing untouched. A line that cannot even
/// be *read* is skipped the same way, by `for_each_readable_line`.
fn spawn_sidecar_reader(app: AppHandle, sidecar: Arc<Sidecar>, stdout: ChildStdout) {
    use tauri::Emitter;
    std::thread::spawn(move || {
        for_each_readable_line(BufReader::new(stdout), |line| {
            let parsed = serde_json::from_str::<serde_json::Value>(&line).ok();
            let is_chunk = parsed
                .as_ref()
                .and_then(|v| v.get("type"))
                .and_then(|t| t.as_str())
                == Some("chunk");
            if is_chunk {
                if let Some(value) = parsed {
                    if let Err(e) = app.emit("chat-chunk", value) {
                        eprintln!("[notebook] emit chat-chunk failed: {e}");
                    }
                }
                return;
            }
            let waiter = parsed
                .and_then(|v| v.get("id").and_then(|i| i.as_u64()))
                .and_then(|id| sidecar.pending.lock().ok()?.remove(&id));
            match waiter {
                Some(tx) => {
                    let _ = tx.send(line);
                }
                None => eprintln!("[notebook] unmatched sidecar response: {line}"),
            }
        });
    });
}

/// Hands every readable line of `reader` to `on_line`, skipping and logging the
/// ones that cannot be read.
///
/// `Lines` yields `Err` for a line that is not valid UTF-8 — but `read_until`
/// has already consumed those bytes, so iteration simply resumes at the next
/// line. The `map_while(Result::ok)` this replaces ended the iterator on the
/// first such error instead, killing the reader thread: every pending request
/// waiter (a UI ping, a background enrichment job) then blocked forever with no
/// one left to answer it. Only EOF ends the loop now.
pub fn for_each_readable_line<R: BufRead>(reader: R, mut on_line: impl FnMut(String)) {
    for line in reader.lines() {
        match line {
            Ok(line) => on_line(line),
            Err(e) => eprintln!("[notebook] skipped unreadable sidecar line: {e}"),
        }
    }
}

fn kill_sidecar(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    let mut guard = match state.0.proc.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(mut proc) = guard.take() {
        let _ = proc.child.kill();
        let _ = proc.child.wait();
    }
}

/// Round-trip proof: send a `ping` line, wait for its response line (10s).
#[tauri::command]
fn sidecar_ping(state: tauri::State<SidecarState>) -> Result<String, String> {
    let rx = state.0.call("ping", None)?;
    rx.recv_timeout(Duration::from_secs(10))
        .map_err(|_| "sidecar ping timed out".to_string())
}

// --- Chat (T14) --------------------------------------------------------------
//
// One turn of the overlay's chat view. The answer streams back out of band as
// `chat-chunk` events (see spawn_sidecar_reader); this command's return value
// is the finished answer plus the SDK session id to continue from.
//
// The vault dir comes from IndexState, not from the frontend: there is exactly
// one resolved vault path in the process and chat must not be able to point
// the agent at a different directory.

/// A chat turn greps and reads notes before answering, so it is slower than a
/// one-shot prompt but much faster than an enrichment job.
const CHAT_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(serde::Serialize)]
struct ChatReply {
    text: String,
    /// SDK session id; the frontend sends it back on the next turn.
    session: Option<String>,
}

#[tauri::command]
async fn chat_send(
    sidecar: State<'_, SidecarState>,
    index: State<'_, IndexState>,
    text: String,
    session: Option<String>,
    turn: String,
) -> Result<ChatReply, String> {
    let rx = sidecar.0.call(
        "chat",
        Some(serde_json::json!({
            "vaultDir": index.vault_dir.to_string_lossy(),
            "text": text,
            "session": session,
            "turn": turn,
        })),
    )?;
    // Off the async runtime's threads: the wait is minutes long and blocking.
    let line = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(CHAT_TIMEOUT)
            .map_err(|_| "no response within the chat timeout".to_string())
    })
    .await
    .map_err(|e| format!("chat wait failed: {e}"))??;

    let parsed = serde_json::from_str::<serde_json::Value>(&line)
        .map_err(|e| format!("unparseable chat response: {e}"))?;
    if parsed.get("ok").and_then(|b| b.as_bool()) != Some(true) {
        return Err(parsed
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("chat failed")
            .to_string());
    }
    Ok(ChatReply {
        text: parsed
            .pointer("/result/text")
            .and_then(|t| t.as_str())
            .unwrap_or_default()
            .to_string(),
        session: parsed
            .pointer("/result/session")
            .and_then(|s| s.as_str())
            .map(str::to_string),
    })
}

// --- Knowledge enrichment (T12) ---------------------------------------------
//
// Trigger is the vault file watcher, not a hook in the capture UI: the file is
// always on disk before a job starts (capture latency is untouched), and it
// works no matter what wrote the note — capture overlay, note editor, MCP, or
// the user's own text editor.

/// A job may fetch a URL and take a model turn or two.
const ENRICH_TIMEOUT: Duration = Duration::from_secs(180);

/// The enrichment queue.
///
/// `dispatched` holds every note id queued during this app session and ids are
/// **never removed**. A job that fails writes nothing, so it leaves no
/// `enriched` marker and the startup reindex re-selects it next launch — but
/// it is not retried in a loop for the rest of this session, which would burn
/// the user's subscription on a note that keeps failing.
struct EnrichQueue {
    tx: mpsc::Sender<enrich::EnrichJob>,
    dispatched: Mutex<HashSet<String>>,
}

/// One job at a time: enrichment is background work and must never contend
/// with the user's own foreground prompts.
fn spawn_enrich_worker(
    sidecar: Arc<Sidecar>,
    vault_dir: PathBuf,
) -> mpsc::Sender<enrich::EnrichJob> {
    let (tx, rx) = mpsc::channel::<enrich::EnrichJob>();
    std::thread::spawn(move || {
        for job in rx {
            let params = serde_json::json!({
                "vaultDir": vault_dir.to_string_lossy(),
                "path": job.path,
                "related": job.related,
            });
            let reply = sidecar.call("enrich", Some(params)).and_then(|rx| {
                rx.recv_timeout(ENRICH_TIMEOUT)
                    .map_err(|_| "no response within the enrichment timeout".to_string())
            });
            match reply {
                Ok(line) => {
                    let parsed = serde_json::from_str::<serde_json::Value>(&line).ok();
                    let ok = parsed
                        .as_ref()
                        .and_then(|v| v.get("ok").and_then(|b| b.as_bool()))
                        .unwrap_or(false);
                    // `ok: true` covers both "wrote the marker" and "did
                    // nothing" — distinguish them, because a skip means this
                    // note is done for the session while the job log is the
                    // only place that says why.
                    let status = parsed
                        .as_ref()
                        .and_then(|v| v.pointer("/result/status").and_then(|s| s.as_str()))
                        .unwrap_or("unknown");
                    match (ok, status) {
                        (true, "enriched") => eprintln!("[enrich] {}: enriched: {line}", job.id),
                        (true, _) => eprintln!("[enrich] {}: skipped, note unchanged: {line}", job.id),
                        (false, _) => {
                            eprintln!("[enrich] {}: job failed, note left untouched: {line}", job.id)
                        }
                    }
                }
                // Sidecar unreachable / dead / timed out: the note on disk is
                // untouched and unmarked, so the next app start retries it.
                Err(e) => eprintln!(
                    "[enrich] {}: job not run, note left untouched: {e}",
                    job.id
                ),
            }
        }
    });
    tx
}

/// Queues one job per knowledge note that still lacks an `enriched` marker.
fn dispatch_enrichment(
    conn: &Arc<Mutex<rusqlite::Connection>>,
    vault_dir: &Path,
    queue: &EnrichQueue,
) {
    let jobs = {
        let Ok(conn) = conn.lock() else {
            return;
        };
        match enrich::pending_jobs(&conn, vault_dir) {
            Ok(jobs) => jobs,
            Err(e) => {
                eprintln!("[enrich] selecting pending notes failed: {e}");
                return;
            }
        }
    };
    let Ok(mut dispatched) = queue.dispatched.lock() else {
        return;
    };
    for job in jobs {
        // A debounce burst can reindex several times before a job finishes;
        // this keeps the same note from being queued twice.
        if !dispatched.insert(job.id.clone()) {
            continue;
        }
        eprintln!("[enrich] queued {}", job.id);
        if queue.tx.send(job).is_err() {
            eprintln!("[enrich] worker is gone; enrichment disabled");
            return;
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([TOGGLE_OVERLAY_SHORTCUT, TASKS_VIEW_SHORTCUT])
                .expect("global shortcuts must parse as valid shortcuts")
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let is_tasks = TASKS_VIEW_SHORTCUT
                            .parse::<Shortcut>()
                            .is_ok_and(|s| s == *shortcut);
                        if is_tasks {
                            open_tasks_view(app);
                        } else {
                            toggle_overlay(app);
                        }
                    }
                })
                .build(),
        )
        .manage(SidecarState::default())
        .invoke_handler(tauri::generate_handler![
            hide_overlay,
            search_notes,
            list_tasks,
            due_alerts,
            reindex,
            vault_read_file,
            vault_write_file,
            vault_readdir,
            vault_mkdir,
            home_dir,
            sidecar_ping,
            chat_send,
            shoot_view,
            shoot_show_overlay
        ])
        .setup(|app| {
            // Start the agent sidecar first: the enrichment retry pass below
            // dispatches to it immediately. The app still works without it —
            // jobs just log as "not run" and retry on a later start.
            let sidecar = app.state::<SidecarState>().0.clone();
            match spawn_sidecar() {
                Ok((child, stdin, stdout)) => {
                    spawn_sidecar_reader(app.handle().clone(), sidecar.clone(), stdout);
                    *sidecar.proc.lock().unwrap() = Some(SidecarProc {
                        child,
                        stdin,
                        next_id: 0,
                    });
                }
                Err(e) => eprintln!("[notebook] sidecar failed to start: {e}"),
            }

            // SQLite index: db in app data dir (outside the vault), initial
            // full scan on start, watcher-driven rescans on file change.
            let db_path = app.path().app_data_dir()?.join("index.db");
            let vault_dir = index::resolve_vault_dir(&app.path().home_dir()?);
            let _ = std::fs::create_dir_all(&vault_dir);
            let conn = index::open_db(&db_path)?;
            if let Err(e) = index::reindex(&conn, &vault_dir) {
                eprintln!("index: initial reindex failed: {e}");
            }
            let conn = Arc::new(Mutex::new(conn));

            let queue = Arc::new(EnrichQueue {
                tx: spawn_enrich_worker(sidecar, vault_dir.clone()),
                dispatched: Mutex::new(HashSet::new()),
            });
            // Retry pass: any knowledge note still missing the `enriched`
            // marker — a job that failed in an earlier session, or a note
            // written while the app was closed.
            dispatch_enrichment(&conn, &vault_dir, &queue);

            let watcher = {
                let conn = conn.clone();
                let vault_dir = vault_dir.clone();
                let queue = queue.clone();
                index::spawn_watcher(vault_dir.clone(), conn.clone(), move || {
                    dispatch_enrichment(&conn, &vault_dir, &queue)
                })
            };
            let watcher = match watcher {
                Ok(w) => Some(w),
                Err(e) => {
                    eprintln!("index: vault watcher failed to start: {e}");
                    None
                }
            };
            // Alert scheduler: after the initial reindex above, so its first
            // (catch-up) pass sees the whole vault.
            spawn_alert_scheduler(app.handle().clone(), conn.clone());

            app.manage(IndexState {
                conn,
                vault_dir,
                _watcher: watcher,
            });

            // Resident tray app: no dock icon.
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let quit = MenuItem::with_id(app, "quit", "Quit notebook", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            TrayIconBuilder::with_id("notebook-tray")
                .icon(app.default_window_icon().expect("default window icon").clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            // Convert the main window into a floating NSPanel.
            let window = app
                .get_webview_window(OVERLAY_WINDOW_LABEL)
                .expect("overlay window must exist");
            window.to_panel::<OverlayPanel>()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                kill_sidecar(app);
            }
        });
}
