//! Multi-window: open a book in its own window, route files from a second launch, and save and
//! restore the set of open windows. The bookkeeping lives in `session.rs`.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_specta::Event;

use crate::backend::error::{Error, ErrorCode, Res};
use crate::backend::model::Json;
use crate::backend::Core;
use crate::protocol::AllowList;
use crate::session::{self, Registry, Session, WinRec, MAIN, RESTORE_KEY, SESSION_KEY};
use crate::window;
use crate::OpenFiles;

#[derive(Default)]
pub struct SessionState {
    /// The book the main window showed last time (taken once by the frontend at boot).
    main_book: Mutex<Option<String>>,
    saved: AtomicBool,
}

/// Window cascade offset in physical px.
const CASCADE: i32 = 36;

/// Open `book_id` in a new reader window (`rec`: restore that window's label and bounds).
/// If another window already shows the book, that window is focused instead (not when restoring).
pub fn open_reader_window(app: &AppHandle, book_id: &str, locator: Option<&serde_json::Value>, rec: Option<&WinRec>) -> Res<String> {
    let reg = app.state::<Registry>();
    if rec.is_none() {
        if let Some(w) = reg.window_showing(book_id).and_then(|l| app.get_webview_window(&l)) {
            window::focus(&w);
            return Ok(w.label().to_string());
        }
    }
    let label = rec.map(|r| r.label.clone()).unwrap_or_else(|| reg.next_label());
    reg.reserve(&label);
    let boot = serde_json::json!({ "bookId": book_id, "locator": locator });
    let recent = reg.most_recent().and_then(|l| app.get_webview_window(&l));
    let w = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Quire")
        .inner_size(1280.0, 800.0)
        .min_inner_size(720.0, 480.0)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .visible(false)
        .initialization_script(format!("window.__QUIRE_BOOT__={boot};"))
        .build()
        .map_err(|e| Error::new(ErrorCode::Io, format!("Couldn't open a new window ({e}).")))?;
    reg.add(&label);
    reg.set_book(&label, Some(book_id.to_string()));
    window::setup(app, &w);
    match rec {
        Some(r) => {
            let b = session::clamp_to_monitors(r.bounds, &window::monitor_rects(app));
            let _ = w.set_size(tauri::PhysicalSize::new(b.w, b.h));
            let _ = w.set_position(tauri::PhysicalPosition::new(b.x, b.y));
            if r.maximized {
                let _ = w.maximize();
            }
        }
        None => match recent.as_ref().and_then(window::outer_rect).filter(|_| !recent.as_ref().is_some_and(|r| r.is_maximized().unwrap_or(false))) {
            Some(r) => {
                let _ = w.set_size(tauri::PhysicalSize::new(r.w, r.h));
                let _ = w.set_position(tauri::PhysicalPosition::new(r.x + CASCADE, r.y + CASCADE));
                window::ensure_on_screen(app, &w);
            }
            None => {
                let _ = w.center();
            }
        },
    }
    let _ = w.show();
    let _ = w.set_focus();
    Ok(label)
}

/// Files from a second launch: the first goes to the most recently focused window, the rest each
/// open in a new window. A book that another window already shows is focused instead.
pub fn route_files(app: &AppHandle, paths: Vec<String>) {
    let allow = app.state::<AllowList>();
    let paths: Vec<String> = paths.into_iter().filter(|p| allow.allow(Path::new(p)).is_ok()).collect();
    let reg = app.state::<Registry>();
    let core = app.state::<Arc<Core>>();
    let recent = || reg.most_recent().and_then(|l| app.get_webview_window(&l)).or_else(|| app.get_webview_window(MAIN));
    let mut used_recent = false;
    for p in &paths {
        let id = core.open_document(p).ok().map(|d| d.book.id);
        if let Some(w) = id.as_deref().and_then(|id| reg.window_showing(id)).and_then(|l| app.get_webview_window(&l)) {
            window::focus(&w);
        } else if !used_recent {
            used_recent = true;
            if let Some(w) = recent() {
                let _ = OpenFiles(vec![p.clone()]).emit_to(app, w.label());
                window::focus(&w);
            }
        } else if let Some(id) = id {
            let _ = open_reader_window(app, &id, None, None);
        }
    }
    if paths.is_empty() {
        if let Some(w) = recent() {
            window::focus(&w);
        }
    }
}

/// Persist the open windows. Idempotent: only the first call (main window closing) counts, so the
/// window teardown that follows never overwrites it with an empty session.
pub fn save_session(app: &AppHandle) {
    if app.state::<SessionState>().saved.swap(true, Ordering::SeqCst) {
        return;
    }
    let reg = app.state::<Registry>();
    let mut wins: Vec<WinRec> = app
        .webview_windows()
        .into_iter()
        .filter(|(l, _)| l != "indexer")
        .filter_map(|(label, w)| {
            let maximized = w.is_maximized().unwrap_or(false);
            Some(WinRec { book_id: reg.book_of(&label), bounds: session::bounds_to_save(maximized, reg.normal(&label), window::outer_rect(&w))?, maximized, label })
        })
        .collect();
    wins.sort_by(|a, b| (a.label != MAIN, &a.label).cmp(&(b.label != MAIN, &b.label)));
    if let Ok(v) = serde_json::to_value(Session::new(wins)) {
        let _ = app.state::<Arc<Core>>().db.set_setting(SESSION_KEY, &v);
    }
}

/// Close every other window so each saves its reading position, then the app exits with the last one.
pub fn close_all_but(app: &AppHandle, keep: &str) {
    for (l, w) in app.webview_windows() {
        if l != keep && l != "indexer" {
            let _ = w.close();
        }
    }
}

/// Launch: hand the main window its book and reopen the other windows. `launch` are the files the
/// app was started with; the first belongs to the main window (it takes them itself).
pub fn restore(app: &AppHandle, launch: Vec<String>) {
    let core = app.state::<Arc<Core>>();
    let enabled = core.db.get_setting(RESTORE_KEY).ok().flatten().and_then(|v| v.as_bool()).unwrap_or(true);
    let session = if enabled { core.db.get_setting(SESSION_KEY).ok().flatten().map(|v| Session::parse(&v)).unwrap_or_default() } else { Session::default() };
    *app.state::<SessionState>().main_book.lock().unwrap() = session.main().and_then(|m| m.book_id.clone());
    let app = app.clone();
    // Windows are built off the setup thread so a slow database can't hold up the first paint.
    tauri::async_runtime::spawn(async move {
        let core = app.state::<Arc<Core>>();
        let mut seen: Vec<String> = session.main().and_then(|m| m.book_id.clone()).into_iter().collect();
        for rec in session.windows.iter().filter(|w| w.label != MAIN) {
            let Some(id) = rec.book_id.as_ref().filter(|id| !seen.contains(id)) else { continue };
            if core.db.get_book(id).is_ok_and(|b| b.available) {
                seen.push(id.clone());
                let _ = open_reader_window(&app, id, None, Some(rec));
            }
        }
        for p in launch.iter().skip(1) {
            if let Ok(d) = core.open_document(p) {
                let _ = open_reader_window(&app, &d.book.id, None, None);
            }
        }
    });
}

/// Open a book in its own window (or focus the window that already shows it). Returns the label.
#[tauri::command]
#[specta::specta]
pub async fn open_book_window(app: AppHandle, core: State<'_, Arc<Core>>, book_id: String, locator: Option<Json>) -> Res<String> {
    let book = core.db.get_book(&book_id)?;
    if !book.available {
        return Err(Error::not_found("that file"));
    }
    open_reader_window(&app, &book_id, locator.as_ref().map(|j| &j.0), None)
}

/// The window reports which book it shows (None: the library) for dedupe and session save.
#[tauri::command]
#[specta::specta]
pub fn window_set_book(window: WebviewWindow, reg: State<Registry>, book_id: Option<String>) {
    reg.set_book(window.label(), book_id);
}

/// The main window's book from the last session, once. None when restore is off or there was none.
#[tauri::command]
#[specta::specta]
pub fn take_session_book(window: WebviewWindow, st: State<SessionState>) -> Option<String> {
    if window.label() != MAIN {
        return None;
    }
    st.main_book.lock().unwrap().take()
}
