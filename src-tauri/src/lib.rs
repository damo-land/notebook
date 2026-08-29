pub mod alerts;
pub mod enrich;
pub mod index;

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

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

// Minimal filesystem bridge for the TS vault library (src/lib/vault): the
// frontend's VaultFs is implemented over these commands. Plain std::fs; the
// path clamp that keeps notes inside the vault lives in TS (notePath).

#[tauri::command]
fn vault_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

#[tauri::command]
fn vault_write_file(path: String, data: String) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| format!("write {path}: {e}"))
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

/// Reads response lines and hands each to the caller that asked for that id.
fn spawn_sidecar_reader(sidecar: Arc<Sidecar>, stdout: ChildStdout) {
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let waiter = serde_json::from_str::<serde_json::Value>(&line)
                .ok()
                .and_then(|v| v.get("id").and_then(|i| i.as_u64()))
                .and_then(|id| sidecar.pending.lock().ok()?.remove(&id));
            match waiter {
                Some(tx) => {
                    let _ = tx.send(line);
                }
                None => eprintln!("[notebook] unmatched sidecar response: {line}"),
            }
        }
    });
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
            sidecar_ping
        ])
        .setup(|app| {
            // Start the agent sidecar first: the enrichment retry pass below
            // dispatches to it immediately. The app still works without it —
            // jobs just log as "not run" and retry on a later start.
            let sidecar = app.state::<SidecarState>().0.clone();
            match spawn_sidecar() {
                Ok((child, stdin, stdout)) => {
                    spawn_sidecar_reader(sidecar.clone(), stdout);
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
