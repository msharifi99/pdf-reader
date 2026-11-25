//! Skeleton commands proving the specta pipeline. T4 adds the library/DB commands.

use std::path::Path;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::protocol::AllowList;
use crate::window::{self, Backdrop};

/// Files passed on the command line at first launch; drained by `take_launch_files`.
#[derive(Default)]
pub struct LaunchFiles(pub Mutex<Vec<String>>);

#[tauri::command]
#[specta::specta]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Returns (and clears) the file paths the app was launched with.
#[tauri::command]
#[specta::specta]
pub fn take_launch_files(files: State<LaunchFiles>) -> Vec<String> {
    std::mem::take(&mut *files.0.lock().unwrap())
}

/// Let the `quire://file?path=` protocol serve this file. Returns false if the path is unreadable.
#[tauri::command]
#[specta::specta]
pub fn allow_path(allow: State<AllowList>, path: String) -> bool {
    allow.allow(Path::new(&path)).is_ok()
}

/// "mica" | "none". When "none" the frontend must paint an opaque background.
#[tauri::command]
#[specta::specta]
pub fn window_backdrop(app: AppHandle) -> String {
    app.state::<Backdrop>().0.lock().unwrap().clone()
}

#[tauri::command]
#[specta::specta]
pub fn window_minimize(window: WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
#[specta::specta]
pub fn window_toggle_maximize(window: WebviewWindow) {
    window::toggle_maximize(&window);
}

#[tauri::command]
#[specta::specta]
pub fn window_close(window: WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
#[specta::specta]
pub fn window_toggle_fullscreen(window: WebviewWindow) {
    let on = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!on);
}

#[tauri::command]
#[specta::specta]
pub fn window_start_drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

/// Report the HTML maximize button's rect (CSS px, viewport coords) so Windows 11 shows the
/// snap-layout flyout over it. Pass width 0 to disable (e.g. while fullscreen).
#[tauri::command]
#[specta::specta]
pub fn window_set_maxbtn_rect(window: WebviewWindow, x: i32, y: i32, w: i32, h: i32) {
    window::set_maxbtn_rect(&window, x as f64, y as f64, w as f64, h as f64);
}
