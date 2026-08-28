pub mod index;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, State,
};
use tauri_nspanel::{tauri_panel, ManagerExt, WebviewWindowExt};
use tauri_plugin_global_shortcut::ShortcutState;

/// Global shortcut that toggles overlay visibility.
/// T8 registers additional shortcuts alongside this one.
pub const TOGGLE_OVERLAY_SHORTCUT: &str = "alt+space";

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_nspanel::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([TOGGLE_OVERLAY_SHORTCUT])
                .expect("TOGGLE_OVERLAY_SHORTCUT must parse as a valid shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_overlay(app);
                    }
                })
                .build(),
        )
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
            home_dir
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
