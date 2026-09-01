pub mod alerts;
pub mod enrich;
pub mod index;
pub mod llm_config;
pub mod placement;

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, State,
};
use tauri_nspanel::{tauri_panel, ManagerExt, WebviewWindowExt};
// Aliased: `ManagerExt` is already taken by tauri_nspanel above.
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

/// Global shortcut that toggles overlay visibility.
/// T8 registers additional shortcuts alongside this one.
pub const TOGGLE_OVERLAY_SHORTCUT: &str = "alt+space";

/// Global shortcut that opens the overlay directly in the tasks view (T8).
/// Shows the panel and emits `open-tasks-view` to the frontend.
pub const TASKS_VIEW_SHORTCUT: &str = "alt+shift+space";

const OVERLAY_WINDOW_LABEL: &str = "main";

/// Emitted every time the overlay panel is put on screen.
///
/// The panel is shown from Rust — a global shortcut, or the tray — so the
/// webview is never told by the act of showing that it just became visible:
/// it is already mounted and running, and nothing in the DOM changes. The
/// frontend listens for this to move focus into its input (T3 consumes it).
pub const OVERLAY_SHOWN_EVENT: &str = "overlay-shown";

/// Emitted every time the overlay panel leaves the screen.
///
/// The twin of [`OVERLAY_SHOWN_EVENT`], and needed for the same reason: the
/// webview keeps running while the panel is hidden, so being taken off screen
/// is invisible to the page unless it is told. The frontend listens for this
/// to discard unsaved input, which is what makes every dismissal — Esc,
/// Ctrl+W, the alt+space toggle, and clicking outside — start the next open
/// from an empty overlay.
///
/// Emitted from [`hide_overlay_panel`], the single function every one of those
/// paths goes through, so no dismissal can skip it.
pub const OVERLAY_HIDDEN_EVENT: &str = "overlay-hidden";

tauri_panel! {
    panel!(OverlayPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

/// Puts the overlay on screen and announces it as [`OVERLAY_SHOWN_EVENT`].
///
/// Every show path goes through here, so "the panel is visible" and "the
/// frontend has been told" can never drift apart.
///
/// The panel becomes key WITHOUT the app activating: setup gives it the
/// `NonactivatingPanel` style mask (the Spotlight/Alfred mechanism), which is
/// what lets `makeKeyWindow` succeed while another app stays frontmost. A
/// scratch AppKit probe confirmed the mechanism: without that mask an
/// accessory app's `makeKeyWindow` silently fails (`isKeyWindow` stays false)
/// whenever another app is active — exactly the shipped "shown but typing
/// goes elsewhere" bug.
fn show_overlay(app: &AppHandle) {
    let Ok(panel) = app.get_webview_panel(OVERLAY_WINDOW_LABEL) else {
        return;
    };
    place_overlay_on_cursor_display(app);
    panel.show_and_make_key();
    log_key_window_status(panel.as_ref());
    log_key_window_status_delayed(app, Duration::from_millis(300));
    emit_overlay_shown(app);
}

/// Logs whether the panel actually became key, immediately after the show.
///
/// `isKeyWindow` asked of the panel itself is the strongest check available
/// from inside the process — but it is still an in-process probe, and an
/// earlier in-page probe once passed while the real alt+space path was
/// broken. The end-to-end truth (a keystroke landing in the input with no
/// prior click) can only be confirmed by a human at the keyboard.
fn log_key_window_status(panel: &dyn tauri_nspanel::Panel) {
    let ns = panel.as_panel();
    eprintln!(
        "[overlay] key-window check after show_and_make_key: isKeyWindow={} styleMask={:#x}",
        ns.isKeyWindow(),
        ns.styleMask().0,
    );
}

/// Asks the same question again shortly after the show settles, and retries
/// `makeKeyWindow` once if the answer is still no.
///
/// Measured behaviour (harness dev logs): on the process's very FIRST show
/// the immediate check reads false — AppKit finishes granting key status a
/// beat after `makeKeyWindow` returns for a window that has never been on
/// screen — and every later show reads true immediately. The retry covers
/// that first-show window; it is skipped when the panel was hidden again in
/// the meantime, so it can never steal key status back after a dismissal.
fn log_key_window_status_delayed(app: &AppHandle, delay: Duration) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        let _ = app.clone().run_on_main_thread(move || {
            if let Ok(panel) = app.get_webview_panel(OVERLAY_WINDOW_LABEL) {
                if !panel.is_visible() {
                    return;
                }
                let was_key = panel.as_panel().isKeyWindow();
                if !was_key {
                    panel.make_key_window();
                }
                eprintln!(
                    "[overlay] key-window recheck after {}ms: isKeyWindow={}{}",
                    delay.as_millis(),
                    panel.as_panel().isKeyWindow(),
                    if was_key { "" } else { " (retried makeKeyWindow)" },
                );
            }
        });
    });
}

/// The display the overlay was last placed on, in points. Written by
/// [`place_overlay_on_cursor_display`] on every show; read by the height
/// clamp so it derives from the CHOSEN display rather than whatever
/// `current_monitor` thinks mid-move.
#[derive(Default)]
struct ChosenDisplay(Mutex<Option<placement::Rect>>);

/// Moves the overlay to the display containing the mouse cursor: horizontally
/// centered, top edge at [`placement::OVERLAY_TOP_FRACTION`] of that
/// display's height. Runs on EVERY show, so the dynamic-height resizes of a
/// previous session cannot leave a stale anchor (the old `center: true`
/// placement centered once, at launch, at the original 320pt size).
///
/// All math is in points — see the doc comment on [`placement`] for why the
/// tao "physical" numbers must not be compared across monitors directly.
fn place_overlay_on_cursor_display(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) else {
        return;
    };
    let monitors = match window.available_monitors() {
        Ok(monitors) if !monitors.is_empty() => monitors,
        Ok(_) => return,
        Err(e) => {
            eprintln!("[overlay] available_monitors failed: {e}");
            return;
        }
    };
    let cursor = match app.cursor_position() {
        Ok(cursor) => cursor,
        Err(e) => {
            eprintln!("[overlay] cursor_position failed: {e}");
            return;
        }
    };
    let primary_scale = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let cursor_pt = placement::cursor_points((cursor.x, cursor.y), primary_scale);

    let rects: Vec<placement::Rect> = monitors
        .iter()
        .map(|m| {
            placement::monitor_rect_points(
                (m.position().x as f64, m.position().y as f64),
                (m.size().width as f64, m.size().height as f64),
                m.scale_factor(),
            )
        })
        .collect();
    let Some(idx) = placement::pick_monitor(cursor_pt, &rects) else {
        return;
    };
    let chosen = rects[idx];

    // The panel's logical width is scale-invariant (config says 640pt), so
    // reading it through the window's CURRENT monitor scale is correct even
    // when the chosen display has a different one.
    let width_pt = window
        .scale_factor()
        .ok()
        .zip(window.inner_size().ok())
        .map(|(scale, size)| size.to_logical::<f64>(scale).width)
        .unwrap_or(640.0);
    let (x, y) = placement::overlay_origin(&chosen, width_pt);
    if let Err(e) = window.set_position(tauri::LogicalPosition::new(x, y)) {
        eprintln!("[overlay] set_position failed: {e}");
        return;
    }
    eprintln!(
        "[overlay] cursor ({:.1}, {:.1}) pt -> monitor {} \"{}\" at ({:.0}, {:.0}) {:.0}x{:.0} pt @ {}x -> origin ({:.1}, {:.1}) pt",
        cursor_pt.0,
        cursor_pt.1,
        idx,
        monitors[idx].name().map(String::as_str).unwrap_or("?"),
        chosen.x,
        chosen.y,
        chosen.width,
        chosen.height,
        monitors[idx].scale_factor(),
        x,
        y,
    );
    if let Ok(mut guard) = app.state::<ChosenDisplay>().0.lock() {
        *guard = Some(chosen);
    }
}

/// Announce [`OVERLAY_SHOWN_EVENT`]. Split out so the screenshot hook's own
/// present path can announce it too — a capture that did not emit this would
/// show focus landing by `autoFocus` at mount and prove nothing about reopens.
fn emit_overlay_shown(app: &AppHandle) {
    use tauri::Emitter;
    if let Err(e) = app.emit(OVERLAY_SHOWN_EVENT, ()) {
        eprintln!("emit {OVERLAY_SHOWN_EVENT}: {e}");
    }
}

/// The one hide used by every dismissal path: the Esc/Ctrl+W keymap through
/// [`hide_overlay`], the alt+space toggle, and the click-outside/resign-key
/// path wired up in `setup`. Announces [`OVERLAY_HIDDEN_EVENT`] so the
/// frontend can discard unsaved input on all of them alike.
fn hide_overlay_panel(app: &AppHandle) {
    if let Ok(panel) = app.get_webview_panel(OVERLAY_WINDOW_LABEL) {
        panel.hide();
    }
    use tauri::Emitter;
    if let Err(e) = app.emit(OVERLAY_HIDDEN_EVENT, ()) {
        eprintln!("emit {OVERLAY_HIDDEN_EVENT}: {e}");
    }
    if shoot_view_env().is_some() {
        eprintln!("[shoot] hid the overlay panel");
    }
}

fn toggle_overlay(app: &AppHandle) {
    if let Ok(panel) = app.get_webview_panel(OVERLAY_WINDOW_LABEL) {
        if panel.is_visible() {
            // Through `hide_overlay_panel`, not `panel.hide()`: toggling the
            // overlay off is the most common dismissal there is, and hiding it
            // here directly would be the one path that skipped the event and
            // left the next open holding a stale draft.
            hide_overlay_panel(app);
            return;
        }
    }
    show_overlay(app);
}

/// Tasks-view shortcut: always show (never toggle-hide) and tell the
/// frontend to switch to the tasks view.
fn open_tasks_view(app: &AppHandle) {
    show_overlay(app);
    use tauri::Emitter;
    if let Err(e) = app.emit("open-tasks-view", ()) {
        eprintln!("emit open-tasks-view: {e}");
    }
}

/// Tray "Settings…" item (T6): always show (never toggle-hide) and tell the
/// frontend to switch to the setup/settings view. Same shape as
/// [`open_tasks_view`].
fn open_settings_view(app: &AppHandle) {
    show_overlay(app);
    use tauri::Emitter;
    if let Err(e) = app.emit("open-settings-view", ()) {
        eprintln!("emit open-settings-view: {e}");
    }
}

/// Invoked from the frontend keymap (Esc / Ctrl+W) to hide the overlay.
#[tauri::command]
fn hide_overlay(app: AppHandle) {
    hide_overlay_panel(&app);
}

/// True while the frontend is in the chat view or has a chat turn in flight.
///
/// Read by the click-outside/resign-key hide in `setup`, and only there: users
/// reported the chat view closing the moment an answer arrived, because
/// something momentarily takes key status off the panel and the resign-key
/// path treats that as a click outside. The focus steal itself is unconfirmed,
/// so this is the defensive half — while chat is on screen or an answer is
/// being written, losing key does not hide the overlay. Esc and Ctrl+W go
/// through [`hide_overlay`] and are unaffected.
#[derive(Default)]
struct ChatActive(AtomicBool);

/// Set (or clear) [`ChatActive`]. The frontend calls this whenever the chat
/// view is entered/left or a turn starts/finishes streaming.
#[tauri::command]
fn set_chat_active(app: AppHandle, active: bool) {
    app.state::<ChatActive>().0.store(active, Ordering::Relaxed);
}

// --- Overlay height ----------------------------------------------------------
//
// The overlay grows to fit its content (T3 measures the DOM and calls
// `resize_overlay`). The bounds are enforced *here* rather than in the caller:
// the height arrives from the webview, and a runaway measurement there must not
// be able to stretch the panel past the screen or collapse it to nothing.

/// Smallest height the overlay may be resized to, in logical points.
///
/// One line of the capture input plus the panel's padding. Below this the
/// input the user is typing into starts to clip.
pub const OVERLAY_MIN_HEIGHT: f64 = 96.0;

/// Largest share of the *active screen's* height the overlay may occupy.
///
/// Spotlight stops well short of filling the screen and so does this: past
/// roughly 60% the overlay stops reading as a floating panel and starts
/// reading as a window.
pub const OVERLAY_MAX_HEIGHT_FRACTION: f64 = 0.60;

/// Maximum height, in logical points, used only when macOS reports no monitor
/// at all. Deliberately conservative: a clamp that is too short is a visual
/// annoyance, one that is taller than the screen is unusable.
const OVERLAY_FALLBACK_MAX_HEIGHT: f64 = 480.0;

/// [`OVERLAY_MAX_HEIGHT_FRACTION`] of the height of the screen the overlay is
/// currently on, in logical points.
///
/// "Active screen" is first and foremost the display the show path CHOSE
/// (`chosen`, from [`place_overlay_on_cursor_display`] — the display under
/// the cursor at summon time). `current_monitor` is only the fallback for a
/// resize that arrives before any show has run: it reads the window's frame,
/// which mid-move can still be the previous display, and clamping against the
/// primary would be wrong on a mixed-height multi-monitor setup.
fn overlay_max_height<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    chosen: Option<placement::Rect>,
) -> f64 {
    if let Some(rect) = chosen {
        if shoot_view_env().is_some() {
            eprintln!(
                "[shoot] clamp derives from the chosen display: {:.0}x{:.0} pt -> max overlay height {:.1} pt",
                rect.width,
                rect.height,
                rect.height * OVERLAY_MAX_HEIGHT_FRACTION,
            );
        }
        return rect.height * OVERLAY_MAX_HEIGHT_FRACTION;
    }
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    match monitor {
        Some(monitor) => {
            let logical = monitor.size().to_logical::<f64>(monitor.scale_factor());
            // Under the screenshot hook only: the physical/logical conversion
            // is invisible on a 1x display and 2x wrong on a Retina one, so the
            // numbers behind the clamp get written to the dev log where a run
            // can check them against the screen it actually ran on.
            if shoot_view_env().is_some() {
                let physical = monitor.size();
                eprintln!(
                    "[shoot] monitor {}x{} px @ {}x scale -> {}x{} pt; max overlay height {:.1} pt",
                    physical.width,
                    physical.height,
                    monitor.scale_factor(),
                    logical.width,
                    logical.height,
                    logical.height * OVERLAY_MAX_HEIGHT_FRACTION,
                );
            }
            logical.height * OVERLAY_MAX_HEIGHT_FRACTION
        }
        None => OVERLAY_FALLBACK_MAX_HEIGHT,
    }
}

/// `requested` confined to [`OVERLAY_MIN_HEIGHT`]..=`max`.
///
/// Split out from [`resize_overlay`] purely so it can be tested without a
/// running Tauri app — this is the part that has to be right.
pub fn clamp_overlay_height(requested: f64, max: f64) -> f64 {
    // `.max(MIN)` first, not paranoia: `f64::clamp` panics when min > max,
    // which a display shorter than ~160pt would produce.
    let max = max.max(OVERLAY_MIN_HEIGHT);
    // NaN has no ordering, so it would slip through `clamp` untouched; fall
    // back to the minimum rather than handing AppKit a garbage frame.
    if requested.is_finite() {
        requested.clamp(OVERLAY_MIN_HEIGHT, max)
    } else {
        OVERLAY_MIN_HEIGHT
    }
}

/// Resizes the overlay to `height` logical points, clamped to
/// [`OVERLAY_MIN_HEIGHT`]..=[`overlay_max_height`]. Returns the height actually
/// applied, so the caller can see when the clamp bit.
#[tauri::command]
fn resize_overlay(app: AppHandle, height: f64) -> Result<f64, String> {
    let window = app
        .get_webview_window(OVERLAY_WINDOW_LABEL)
        .ok_or("overlay window not found")?;

    let chosen = app
        .state::<ChosenDisplay>()
        .0
        .lock()
        .ok()
        .and_then(|guard| *guard);
    let clamped = clamp_overlay_height(height, overlay_max_height(&window, chosen));

    // Width is untouched — only the height is content-driven.
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let width = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale)
        .width;

    window
        .set_size(tauri::LogicalSize::new(width, clamped))
        .map_err(|e| e.to_string())?;
    if shoot_view_env().is_some() {
        eprintln!("[shoot] resize_overlay: requested {height:.1} pt -> applied {clamped:.1} pt");
    }
    Ok(clamped)
}

// --- Dev-only screenshot hook (scripts/shoot.sh) -----------------------------
//
// The overlay is only reachable through a global hotkey, and synthesising one
// from a script needs macOS Accessibility permission that an unattended run
// cannot grant. So `scripts/shoot.sh` launches a debug build with
// `STASH_SHOOT_VIEW=<capture|tasks|search|chat|editor>` instead: the
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
    std::env::var("STASH_SHOOT_VIEW")
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

/// Content controls for a capture, so a screenshot can show something other
/// than an empty overlay. Both are inert without `STASH_SHOOT_VIEW`.
#[derive(serde::Serialize)]
struct ShootInput {
    /// Text put into the capture input at mount — the overlay has to hold
    /// content before its height can be shown following that content, and no
    /// unattended run can type (macOS Accessibility is not granted).
    seed: Option<String>,
    /// Text "typed" after a hide/show cycle. Its presence asks the frontend to
    /// dismiss and reopen the panel before the capture, then insert this at
    /// the caret of whatever holds DOM focus. Nothing lands unless focus was
    /// actually restored on reopen, so the resulting PNG is the evidence: the
    /// typed text present, and the seeded text gone.
    typed: Option<String>,
}

/// `\n` is expanded so multi-line values survive being passed as one argument.
fn shoot_env_text(key: &str) -> Option<String> {
    shoot_view_env()?;
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .map(|v| v.replace("\\n", "\n"))
}

#[tauri::command]
fn shoot_input() -> ShootInput {
    let input = ShootInput {
        seed: shoot_env_text("STASH_SHOOT_TEXT"),
        typed: shoot_env_text("STASH_SHOOT_TYPE"),
    };
    if let Some(seed) = &input.seed {
        eprintln!("[shoot] seeding the capture input with {} chars", seed.len());
    }
    if let Some(typed) = &input.typed {
        eprintln!("[shoot] will reopen the panel and type {typed:?} into the focused element");
    }
    input
}

/// How many times [`shoot_show_overlay`] re-presents the panel, and how long it
/// waits between attempts.
///
/// One attempt is not enough. While the user is working in another app, a
/// single order-in often leaves the panel undrawn — AppKit reports it visible,
/// the window server never composites it, and `screencapture` has nothing to
/// capture. Retrying makes that a transient rather than a failed run. The
/// attempts stop on their own well before this cap in the normal case: the
/// harness kills the app as soon as it has its PNG.
const SHOOT_SHOW_ATTEMPTS: u32 = 30;
const SHOOT_SHOW_INTERVAL: Duration = Duration::from_secs(2);

/// One attempt at putting the overlay panel on screen. Main thread only:
/// `show_and_make_key` is `orderFrontRegardless` + `makeKeyWindow`, and AppKit
/// ignores those from a background thread — which is where Tauri runs command
/// handlers. The global-shortcut path is already on the main thread; this one
/// has to hop there, or the panel silently never appears.
fn shoot_present_overlay(app: &AppHandle, attempt: u32) {
    let handle = app.clone();
    let hopped = app.run_on_main_thread(move || {
        match handle.get_webview_panel(OVERLAY_WINDOW_LABEL) {
            Ok(panel) => {
                // Redundant with the shipped setup path (which now sets the
                // same collection behavior once at panel creation), but kept
                // so a harness run is self-sufficient even if setup changes.
                use tauri_nspanel::objc2_app_kit::NSWindowCollectionBehavior;
                panel.set_collection_behavior(
                    NSWindowCollectionBehavior::CanJoinAllSpaces
                        | NSWindowCollectionBehavior::FullScreenAuxiliary,
                );
                // Same placement the real show path performs, so a harness
                // run's dev log carries the chosen-monitor/origin evidence.
                place_overlay_on_cursor_display(&handle);
                panel.show_and_make_key();
                log_key_window_status(panel.as_ref());
                log_key_window_status_delayed(&handle, Duration::from_millis(300));
                // Ordering in is not enough while another app is frontmost;
                // activating this app is what actually gets it drawn.
                if let Some(window) = handle.get_webview_window(OVERLAY_WINDOW_LABEL) {
                    if let Err(e) = window.set_focus() {
                        eprintln!("[shoot] could not focus the overlay: {e}");
                    }
                }
                // Same announcement the real show paths make, so a capture
                // exercises the frontend's focus-on-open wiring rather than
                // relying on `autoFocus` having run once at mount.
                emit_overlay_shown(&handle);
                // The dev log is all the harness can read when nothing appears.
                eprintln!("[shoot] presented the overlay panel (attempt {attempt})");
            }
            Err(e) => eprintln!("[shoot] overlay panel not available: {e:?}"),
        }
    });
    if let Err(e) = hopped {
        eprintln!("[shoot] could not reach the main thread: {e}");
    }
}

#[tauri::command]
fn shoot_show_overlay(app: AppHandle) {
    if shoot_view_env().is_none() {
        return;
    }
    shoot_present_overlay(&app, 1);
    // React StrictMode mounts the effect twice in dev, so this command arrives
    // twice; one retry loop is enough.
    static RETRYING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if RETRYING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        for attempt in 2..=SHOOT_SHOW_ATTEMPTS {
            std::thread::sleep(SHOOT_SHOW_INTERVAL);
            shoot_present_overlay(&app, attempt);
        }
    });
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
                .title("Stash reminder")
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
///
/// `vault_dir` is behind an `Arc<Mutex<..>>` because the setup view (T6) can
/// re-point it at runtime via [`set_vault_dir`], and the SAME handle is held
/// by the watcher thread and the enrichment worker — both read the dir at use
/// time, so a switch re-points them too instead of leaving them on a captured
/// launch-time copy. Every command that needs the dir takes a clone through
/// [`IndexState::vault_dir`].
///
/// `watcher` is behind a Mutex so [`set_vault_dir`] can re-register the watch
/// on the newly chosen directory.
struct IndexState {
    conn: Arc<Mutex<rusqlite::Connection>>,
    vault_dir: Arc<Mutex<PathBuf>>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

impl IndexState {
    /// The current vault dir. A poisoned lock is unrecoverable state
    /// corruption; surface it as a command error rather than panicking.
    fn vault_dir(&self) -> Result<PathBuf, String> {
        Ok(self.vault_dir.lock().map_err(|e| e.to_string())?.clone())
    }
}

#[tauri::command]
fn search_notes(state: State<IndexState>, text: String) -> Result<Vec<index::NoteRow>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    index::search_notes(&conn, &text).map_err(|e| e.to_string())
}

/// The search view's empty-query listing (T5): every note, newest file mtime
/// first, straight from the SQLite index.
#[tauri::command]
fn list_notes(state: State<IndexState>) -> Result<Vec<index::NoteRow>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    index::list_all_notes(&conn).map_err(|e| e.to_string())
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
    let vault_dir = state.vault_dir()?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    index::reindex(&conn, &vault_dir).map_err(|e| e.to_string())
}

/// Deletes a note (T4): moves its `.md` file to the macOS Trash — recoverable
/// in Finder, never `fs::remove_file` — then drops its rows from the SQLite
/// index so lists refresh immediately, without waiting for the watcher's
/// debounced rescan (which will fire on the file event anyway and agree).
///
/// The path comes from the index; a stale index falls back to the canonical
/// `<vault>/<id>.md` location (createNote's naming). If the file is already
/// gone the index rows are still dropped, so a delete never wedges on a
/// half-done earlier attempt.
#[tauri::command]
fn delete_note(state: State<IndexState>, id: String) -> Result<(), String> {
    let vault_dir = state.vault_dir()?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let path = index::note_path(&conn, &id)
        .map_err(|e| e.to_string())?
        .map(PathBuf::from)
        .unwrap_or_else(|| vault_dir.join(format!("{id}.md")));
    if path.exists() {
        trash::delete(&path).map_err(|e| format!("trash {}: {e}", path.display()))?;
    }
    index::remove_note(&conn, &id).map_err(|e| e.to_string())
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
        ".stash-{}-{nanos}-{seq}.tmp",
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

// --- Setup / settings (T6) ---------------------------------------------------
//
// First-run wizard + the tray's "Settings…" item, both the same overlay view.
// The vault-path SUGGESTION shown there is frontend logic (the pure
// src/lib/obsidian-vaults.ts, reading obsidian.json through vault_read_file);
// this side owns detection ("is there anything to set up?") and the commit
// ("persist the choice and use it now").

/// True when nothing anywhere picks a vault — no `STASH_VAULT_DIR` override,
/// no `~/.config/stash/config.json`, and no legacy pre-rename vault dir.
/// `resolve_vault_dir` would fall through to its `~/Stash` default, a
/// directory the user never chose, so the frontend shows the first-run
/// wizard instead.
#[tauri::command]
fn needs_setup(app: AppHandle) -> Result<bool, String> {
    if std::env::var("STASH_VAULT_DIR").is_ok_and(|d| !d.trim().is_empty()) {
        return Ok(false); // a harness/tool picked the vault explicitly
    }
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let configured = home.join(".config/stash/config.json").is_file();
    let legacy = home.join(index::LEGACY_VAULT_DIR_NAME).is_dir();
    Ok(!configured && !legacy)
}

/// Confirms the setup view: persists `{"vaultDir": path}` to
/// `~/.config/stash/config.json`, creates the directory, and re-points the
/// RUNNING app at it — in-memory vault dir swapped, index rebuilt, file
/// watcher re-registered on the new directory — so new captures, search,
/// tasks, watcher-driven reindexes and enrichment dispatch all hit the new
/// vault without a restart. The watcher thread and the enrichment worker
/// read the dir from the shared handle at use time (never a launch-time
/// copy), so even a stray event from the old directory can only refresh the
/// index from the CURRENT vault — the old vault can no longer clobber it.
///
/// Known caveats, accepted for a rare settings change: if re-registering the
/// watch on the new directory fails (logged below), EXTERNAL edits to the
/// new vault go unseen until the next app start — the app's own writes still
/// land and index correctly. And between the dir swap and the re-watch a
/// last old-dir event may trigger one redundant reindex of the new vault —
/// harmless.
#[tauri::command]
fn set_vault_dir(app: AppHandle, state: State<IndexState>, path: String) -> Result<(), String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    // `~` expands to home, mirroring resolve_vault_dir; trailing slashes are
    // dropped (the suggested path ends in one) so the stored value is clean.
    let expanded = match path.trim().strip_prefix('~') {
        Some(rest) => format!("{}{}", home.to_string_lossy(), rest),
        None => path.trim().to_string(),
    };
    let expanded = expanded.trim_end_matches('/').to_string();
    if expanded.is_empty() {
        return Err("vault path is empty".into());
    }
    let vault_dir = PathBuf::from(&expanded);

    // Read-modify-write via llm_config::update_config_json (atomic_write
    // underneath, like every other durable write here): config.json is the
    // one file that decides where ALL notes live, and a half-written one
    // would strand the vault behind a parse error. The merge is what keeps a
    // vault change from dropping the `llm` key (and vice versa).
    llm_config::update_config_json(&home, |root| {
        root.insert("vaultDir".into(), serde_json::Value::String(expanded.clone()));
    })?;
    std::fs::create_dir_all(&vault_dir)
        .map_err(|e| format!("mkdir {}: {e}", vault_dir.display()))?;

    // Re-point the running app: swap the in-memory dir first, then rebuild
    // the index so search/tasks show the new vault's notes immediately.
    let old_dir = {
        let mut dir = state.vault_dir.lock().map_err(|e| e.to_string())?;
        std::mem::replace(&mut *dir, vault_dir.clone())
    };
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        index::reindex(&conn, &vault_dir).map_err(|e| e.to_string())?;
    }

    // Re-register the file watch: stop watching the old directory (which may
    // be gone — ignore that) and watch the new one, so external edits to the
    // new vault keep triggering reindexes. The reindex path above already
    // reads the CURRENT dir from the shared handle, so a failure here can
    // never make the old vault overwrite the index — it only costs live
    // pickup of external edits (see the doc comment's caveat).
    if old_dir != vault_dir {
        use notify::Watcher;
        if let Ok(mut watcher) = state.watcher.lock() {
            if let Some(watcher) = watcher.as_mut() {
                let _ = watcher.unwatch(&old_dir);
                if let Err(e) = watcher.watch(&vault_dir, notify::RecursiveMode::NonRecursive) {
                    eprintln!(
                        "index: watching new vault dir {} failed: {e}; external edits are picked up on next app start",
                        vault_dir.display()
                    );
                }
            }
        }
    }
    Ok(())
}

// --- LLM provider config (T2) ------------------------------------------------
//
// `~/.config/stash/config.json` grows an `llm` object alongside `vaultDir`
// (see llm_config.rs for shape and defaulting). There is no in-memory LLM
// state to keep in sync: every chat/enrichment dispatch re-reads the file, so
// a write here applies to the very next call without a restart.

/// The current LLM config (defaults when unconfigured: claude /
/// claude-haiku-4-5). What the settings UI renders.
#[tauri::command]
fn get_llm_config(app: AppHandle) -> Result<llm_config::LlmConfig, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(llm_config::read_llm_config(&home))
}

/// Persists `{"llm": {provider, model}}` into config.json — a merge, through
/// the same atomic-write mechanism as [`set_vault_dir`], so the `vaultDir`
/// key is preserved.
#[tauri::command]
fn set_llm_config(app: AppHandle, provider: String, model: String) -> Result<(), String> {
    let provider = provider.trim().to_string();
    let model = model.trim().to_string();
    if !llm_config::LLM_PROVIDERS.contains(&provider.as_str()) {
        return Err(format!(
            "unknown LLM provider {provider:?} (expected one of {:?})",
            llm_config::LLM_PROVIDERS
        ));
    }
    if model.is_empty() {
        return Err("LLM model is empty".into());
    }
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    llm_config::update_config_json(&home, |root| {
        root.insert(
            "llm".into(),
            serde_json::json!({ "provider": provider, "model": model }),
        );
    })
}

// --- Autostart (launch at login, T1) ------------------------------------------
//
// tauri-plugin-autostart registers the app as a macOS Launch Agent (see the
// `MacosLauncher::LaunchAgent` init in `run`). The plugin — i.e. macOS — is
// the live authority on whether login starts the app; config.json's
// `autostart` key is only the persisted mirror of the user's choice, written
// through the same merge-writer as `vaultDir`/`llm` so no key can clobber
// another (covered by llm_config's merge tests).

/// The plugin's live `is_enabled()`: what macOS will actually do at login,
/// not the config.json mirror.
#[tauri::command]
fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Flips launch-at-login via the plugin AND persists `{"autostart": bool}`
/// into `~/.config/stash/config.json`. Plugin call first: if macOS refuses,
/// nothing is persisted and the file keeps describing reality.
#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())?;
    } else {
        autolaunch.disable().map_err(|e| e.to_string())?;
    }
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    llm_config::update_config_json(&home, |root| {
        root.insert("autostart".into(), serde_json::Value::Bool(enabled));
    })
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
                        eprintln!("[stash] emit chat-chunk failed: {e}");
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
                None => eprintln!("[stash] unmatched sidecar response: {line}"),
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
            Err(e) => eprintln!("[stash] skipped unreadable sidecar line: {e}"),
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

// --- Provider status probes (T2) ---------------------------------------------
//
// Both are settings-UI probes: they answer "is this provider usable right
// now" without the caller having to interpret a failed chat. Each returns the
// sidecar's `result` value as-is — the shapes are documented on the sidecar
// methods (main.ts): claudeStatus -> {authenticated, detail}, ollamaStatus ->
// {reachable, models}.

/// The Claude probe makes one real (tiny) model call — that IS the existing
/// auth detection (llm.ts classifyLlmError), and the OAuth chain lives in the
/// CLI, so there is nothing cheaper to ask.
const CLAUDE_STATUS_TIMEOUT: Duration = Duration::from_secs(60);
/// The Ollama probe is a local HTTP GET with its own ~1.5s fetch timeout;
/// this outer bound only covers a wedged sidecar.
const OLLAMA_STATUS_TIMEOUT: Duration = Duration::from_secs(10);

/// Waits for one sidecar response line and unwraps `{ok, result|error}` into
/// the `result` value. Off the async runtime's threads, like chat_send.
async fn await_sidecar_result(
    rx: mpsc::Receiver<String>,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let line = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(timeout)
            .map_err(|_| "no sidecar response within the timeout".to_string())
    })
    .await
    .map_err(|e| format!("sidecar wait failed: {e}"))??;
    let parsed = serde_json::from_str::<serde_json::Value>(&line)
        .map_err(|e| format!("unparseable sidecar response: {e}"))?;
    if parsed.get("ok").and_then(|b| b.as_bool()) != Some(true) {
        return Err(parsed
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("sidecar call failed")
            .to_string());
    }
    Ok(parsed.get("result").cloned().unwrap_or(serde_json::Value::Null))
}

/// Claude auth status: `{authenticated: bool, detail: string|null}`.
#[tauri::command]
async fn claude_auth_status(
    app: AppHandle,
    sidecar: State<'_, SidecarState>,
) -> Result<serde_json::Value, String> {
    let llm = llm_config::read_llm_config(&app.path().home_dir().map_err(|e| e.to_string())?);
    let rx = sidecar
        .0
        .call("claudeStatus", Some(serde_json::json!({ "llm": llm })))?;
    await_sidecar_result(rx, CLAUDE_STATUS_TIMEOUT).await
}

/// Ollama reachability: `{reachable: bool, models: string[]}`. A daemon that
/// is down is a normal `reachable: false` result, not an Err.
#[tauri::command]
async fn ollama_status(sidecar: State<'_, SidecarState>) -> Result<serde_json::Value, String> {
    let rx = sidecar.0.call("ollamaStatus", None)?;
    await_sidecar_result(rx, OLLAMA_STATUS_TIMEOUT).await
}

/// The settings view's Start button: ask the sidecar to spawn `ollama serve`
/// detached. Result is `{started: bool, error?: string}` — a missing binary
/// is a normal `started: false` result, not an Err. The sidecar answers as
/// soon as the process is spawned (or fails to), well inside this timeout.
const OLLAMA_START_TIMEOUT: Duration = Duration::from_secs(10);

#[tauri::command]
async fn ollama_start(sidecar: State<'_, SidecarState>) -> Result<serde_json::Value, String> {
    let rx = sidecar.0.call("ollamaStart", None)?;
    await_sidecar_result(rx, OLLAMA_START_TIMEOUT).await
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
    app: AppHandle,
    sidecar: State<'_, SidecarState>,
    index: State<'_, IndexState>,
    text: String,
    session: Option<String>,
    turn: String,
    // Prior turns of the frontend transcript, passed through UNTOUCHED: the
    // sidecar's ollama provider replays them for conversation continuity
    // (no server-side session exists there); the claude path ignores them.
    history: Option<serde_json::Value>,
) -> Result<ChatReply, String> {
    // LLM config is read fresh from disk PER TURN (never cached): a provider
    // or model change in settings applies to the next message, no restart.
    let llm = llm_config::read_llm_config(&app.path().home_dir().map_err(|e| e.to_string())?);
    let rx = sidecar.0.call(
        "chat",
        Some(serde_json::json!({
            "vaultDir": index.vault_dir()?.to_string_lossy(),
            "text": text,
            "session": session,
            "turn": turn,
            "history": history,
            "llm": llm,
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
///
/// `vault_dir` is the shared handle, read per job — after a vault switch
/// (set_vault_dir), queued and future jobs are dispatched against the
/// CURRENT vault, not the launch-time one.
fn spawn_enrich_worker(
    sidecar: Arc<Sidecar>,
    vault_dir: Arc<Mutex<PathBuf>>,
) -> mpsc::Sender<enrich::EnrichJob> {
    let (tx, rx) = mpsc::channel::<enrich::EnrichJob>();
    std::thread::spawn(move || {
        for job in rx {
            let Ok(vault_dir) = vault_dir.lock().map(|d| d.clone()) else {
                eprintln!("[enrich] {}: job not run, vault dir lock poisoned", job.id);
                continue;
            };
            // LLM config read fresh per job (this thread has no AppHandle,
            // hence $HOME): a provider/model change applies to the next
            // queued job without a restart, matching chat_send.
            let llm = llm_config::read_llm_config_env_home();
            let params = serde_json::json!({
                "vaultDir": vault_dir.to_string_lossy(),
                "path": job.path,
                "related": job.related,
                "llm": llm,
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
                        // No Claude Code OAuth token: the sidecar's typed
                        // NotAuthenticatedError, flattened to its stable
                        // message prefix. One line per queued note; nothing
                        // was written, so a later configured run enriches it —
                        // and `dispatched` already stops any retry loop this
                        // session.
                        (false, _) if line.contains("Not authenticated with Claude Code") => {
                            eprintln!(
                                "[enrich] {}: skipped, LLM not configured (run `claude setup-token`); note left unmarked",
                                job.id
                            )
                        }
                        // Same degradation contract, ollama provider: the
                        // sidecar's typed errors flattened to their stable
                        // message prefixes (sidecar/src/ollama.ts). Nothing
                        // was written, no marker — a later run re-enriches.
                        (false, _) if line.contains("Ollama is not reachable") => {
                            eprintln!(
                                "[enrich] {}: skipped, Ollama not reachable; note left unmarked",
                                job.id
                            )
                        }
                        (false, _) if line.contains("Ollama model missing") => {
                            eprintln!(
                                "[enrich] {}: skipped, model missing — pick another in Settings; note left unmarked",
                                job.id
                            )
                        }
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
        // Launch-at-login as a macOS Launch Agent (the per-user, no-admin
        // mechanism); no extra launch args. Flipped/read at runtime through
        // the get_autostart/set_autostart commands below.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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
        .manage(ChosenDisplay::default())
        .manage(ChatActive::default())
        .invoke_handler(tauri::generate_handler![
            hide_overlay,
            set_chat_active,
            resize_overlay,
            search_notes,
            list_notes,
            list_tasks,
            due_alerts,
            reindex,
            delete_note,
            needs_setup,
            set_vault_dir,
            get_llm_config,
            set_llm_config,
            get_autostart,
            set_autostart,
            claude_auth_status,
            ollama_status,
            ollama_start,
            vault_read_file,
            vault_write_file,
            vault_readdir,
            vault_mkdir,
            home_dir,
            sidecar_ping,
            chat_send,
            shoot_view,
            shoot_input,
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
                Err(e) => eprintln!("[stash] sidecar failed to start: {e}"),
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
            // The ONE vault-dir handle: IndexState (commands, set_vault_dir),
            // the watcher thread and the enrichment worker all share it, so a
            // vault switch re-points every reader at once — none of them keep
            // a launch-time copy.
            let launch_dir = vault_dir.clone();
            let vault_dir = Arc::new(Mutex::new(vault_dir));

            let queue = Arc::new(EnrichQueue {
                tx: spawn_enrich_worker(sidecar, vault_dir.clone()),
                dispatched: Mutex::new(HashSet::new()),
            });
            // Retry pass: any knowledge note still missing the `enriched`
            // marker — a job that failed in an earlier session, or a note
            // written while the app was closed.
            dispatch_enrichment(&conn, &launch_dir, &queue);

            let watcher = {
                let conn = conn.clone();
                let vault_dir = vault_dir.clone();
                let queue = queue.clone();
                index::spawn_watcher(vault_dir.clone(), conn.clone(), move || {
                    // Read the CURRENT dir per dispatch: after a vault switch
                    // this queues the new vault's pending notes, not the old
                    // vault's.
                    let Ok(dir) = vault_dir.lock().map(|d| d.clone()) else {
                        return;
                    };
                    dispatch_enrichment(&conn, &dir, &queue)
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
                watcher: Mutex::new(watcher),
            });

            // Resident tray app: no dock icon.
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit stash", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings, &quit])?;
            TrayIconBuilder::with_id("stash-tray")
                .icon(app.default_window_icon().expect("default window icon").clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id() == "settings" {
                        open_settings_view(app);
                    }
                    if event.id() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            let window = app
                .get_webview_window(OVERLAY_WINDOW_LABEL)
                .expect("overlay window must exist");

            // Native macOS material behind the webview.
            //
            // HudWindow is the material the system's own HUD panels use: dark,
            // heavily blurred, and legible over any wallpaper — the closest
            // stock match for a Spotlight-style overlay. The lighter materials
            // (Sidebar, Popover, HeaderView) read as document chrome, and
            // UnderWindowBackground is tuned for a full window behind content.
            //
            // `NSVisualEffectState::Active` rather than the default
            // FollowsWindowActiveState: an overlay that flattens to plain grey
            // the moment it is not key is exactly the "fixed grey background
            // field" this redesign exists to get rid of.
            //
            // This only shows through because tauri.conf.json sets
            // `"transparent": true` on the window and `"macOSPrivateApi": true`
            // at the app level. Without those the webview paints an opaque
            // layer over the effect view and none of it is visible.
            // The 12.0 radius rounds the NSVisualEffectView itself (the
            // material), and src/App.css puts the SAME 12px border-radius on
            // the webview's #root so the web content is clipped to the exact
            // shape the material has — neither square material behind rounded
            // CSS nor the reverse.
            if let Err(e) = window_vibrancy::apply_vibrancy(
                &window,
                window_vibrancy::NSVisualEffectMaterial::HudWindow,
                Some(window_vibrancy::NSVisualEffectState::Active),
                Some(12.0),
            ) {
                eprintln!("[stash] vibrancy (HudWindow) not applied: {e}");
            }

            // Convert the main window into a floating NSPanel.
            let panel = window.to_panel::<OverlayPanel>()?;

            // NonactivatingPanel is the mechanism behind "summon, then just
            // type": it lets `makeKeyWindow` succeed while the app stays an
            // inactive accessory, so the panel takes keyboard focus without
            // the frontmost app losing active state (its menu bar stays, its
            // windows keep their focused appearance). Without this bit AppKit
            // silently refuses key status for a background app's window — the
            // panel was shown but every keystroke kept going to the previous
            // app. The window is borderless (`decorations: false`), so the
            // mask is exactly this one bit; verified in a scratch AppKit
            // probe before wiring (see show_overlay).
            panel.set_style_mask(
                tauri_nspanel::objc2_app_kit::NSWindowStyleMask::NonactivatingPanel,
            );

            // Follow the user across Spaces. Without this the panel belongs to
            // the one desktop Space it first appeared on, so summoning it from
            // another Space (or over a full-screen app) shows nothing — the
            // panel is "visible" on a Space nobody is looking at.
            // FullScreenAuxiliary lets it overlay full-screen apps instead of
            // bouncing the user out of them. Set once here: collection
            // behavior sticks to the panel, so every show/toggle inherits it.
            {
                use tauri_nspanel::objc2_app_kit::NSWindowCollectionBehavior;
                panel.set_collection_behavior(
                    NSWindowCollectionBehavior::CanJoinAllSpaces
                        | NSWindowCollectionBehavior::FullScreenAuxiliary,
                );
            }

            // Click-outside dismissal. Clicking anything else makes the panel
            // resign key, and macOS reports that through tao's own window
            // delegate as `Focused(false)` — the same hide Esc uses.
            //
            // Deliberately NOT a tauri-nspanel `panel_event!` delegate:
            // `set_event_handler` swaps out tao's delegate wholesale, so Tauri
            // would stop emitting window events at all — including this one.
            // `to_panel` only reclasses the window, leaving tao's delegate
            // (and therefore this event) intact.
            //
            // Suppressed under the screenshot hook, and only there. The harness
            // forces the panel on screen from a script while another app holds
            // the foreground, so the panel takes key and loses it again within
            // the same second — measured: 31 present attempts against 10
            // `resigned key` hides in one run, and the capture never found a
            // visible panel. Dismissal is not what that run is testing, and
            // leaving it armed makes the harness untestable rather than making
            // it honest. `shoot_view_env` is already debug-build-only, so a
            // release build cannot reach this branch at all.
            //
            // Also suppressed while [`ChatActive`] is set — chat view on
            // screen, or a chat turn still in flight. Something takes key
            // status off the panel around the moment an answer lands (root
            // cause unconfirmed), and hiding here threw users out of the chat
            // they were reading. Every explicit dismissal (Esc, Ctrl+W, the
            // alt+space toggle) bypasses this handler entirely, so they all
            // still hide.
            let dismiss_handle = app.handle().clone();
            let shooting = shoot_view_env().is_some();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(false) = event {
                    if shooting {
                        eprintln!("[stash] overlay resigned key (screenshot hook: not hiding)");
                        return;
                    }
                    if dismiss_handle
                        .state::<ChatActive>()
                        .0
                        .load(Ordering::Relaxed)
                    {
                        eprintln!("[stash] overlay resigned key (chat active: not hiding)");
                        return;
                    }
                    eprintln!("[stash] overlay resigned key: hiding");
                    hide_overlay_panel(&dismiss_handle);
                }
            });

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
