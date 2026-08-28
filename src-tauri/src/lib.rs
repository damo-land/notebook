pub mod index;

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
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
// from its stdout. v1 only proves the round trip via `sidecar_ping`; later
// tasks reuse the same handles for real methods.

struct SidecarProc {
    child: Child,
    stdin: ChildStdin,
    /// Lines from the sidecar's stdout, forwarded by a reader thread.
    rx: mpsc::Receiver<String>,
    next_id: u64,
}

#[derive(Default)]
struct SidecarState(Mutex<Option<SidecarProc>>);

/// Dev wiring: the sidecar lives next to src-tauri in the repo.
fn sidecar_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../sidecar")
}

fn spawn_sidecar() -> Result<SidecarProc, String> {
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

    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok(SidecarProc {
        child,
        stdin,
        rx,
        next_id: 0,
    })
}

fn kill_sidecar(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    let mut guard = match state.0.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(mut proc) = guard.take() {
        let _ = proc.child.kill();
        let _ = proc.child.wait();
    }
}

/// Round-trip proof: send a `ping` line, wait for the response line (10s).
#[tauri::command]
fn sidecar_ping(state: tauri::State<SidecarState>) -> Result<String, String> {
    let mut guard = state.0.lock().map_err(|_| "sidecar state poisoned")?;
    let proc = guard.as_mut().ok_or("sidecar not running")?;

    proc.next_id += 1;
    let id = proc.next_id;
    writeln!(proc.stdin, r#"{{"id":{id},"method":"ping"}}"#)
        .and_then(|_| proc.stdin.flush())
        .map_err(|e| format!("write to sidecar: {e}"))?;

    proc.rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "sidecar ping timed out".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_nspanel::init())
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
            let watcher = match index::spawn_watcher(vault_dir.clone(), conn.clone()) {
                Ok(w) => Some(w),
                Err(e) => {
                    eprintln!("index: vault watcher failed to start: {e}");
                    None
                }
            };
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

            // Start the agent sidecar; the app still works without it.
            match spawn_sidecar() {
                Ok(proc) => {
                    *app.state::<SidecarState>().0.lock().unwrap() = Some(proc);
                }
                Err(e) => eprintln!("[notebook] sidecar failed to start: {e}"),
            }

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
