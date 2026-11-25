//! Frameless window plumbing: Mica backdrop, window-control commands, Windows 11 snap layouts.
//!
//! Snap layouts: Windows shows the snap flyout when the top-level window's `WM_NCHITTEST`
//! returns `HTMAXBUTTON` for the cursor. The WebView2 child windows live in another process,
//! so we cannot subclass them and they swallow the hit test. Instead we (1) subclass the
//! top-level window to answer `HTMAXBUTTON` inside the HTML maximize button's rect, and
//! (2) park a tiny invisible child window of our own, same thread, on top of the webview over
//! that rect; it answers `HTTRANSPARENT`, which makes the hit test fall through to its
//! parent (the top-level window). The frontend reports the button rect via
//! `window_set_maxbtn_rect`, and receives `MaxButtonHover` events (addressed to that window)
//! because the webview no longer sees the mouse over that rect.
//!
//! Every window has its own [`SnapState`] in a map keyed by HWND, so any number of windows work.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, WebviewWindow};
use tauri_specta::Event;

/// Fired when the cursor enters/leaves the maximize button (snap-layout hit area).
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type, Event)]
pub struct MaxButtonHover(pub bool);

/// Name of the active backdrop: "mica", "acrylic" or "none". Frontend paints an opaque
/// background when "none".
#[derive(Default)]
pub struct Backdrop(pub std::sync::Mutex<String>);

pub fn setup(app: &AppHandle, window: &WebviewWindow) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        // Mica needs Windows 11 22000+. On Windows 10 stay opaque: acrylic lags badly on drag/resize.
        let kind = match window_vibrancy::apply_mica(window, None) {
            Ok(()) => "mica",
            Err(_) => "none",
        };
        *app.state::<Backdrop>().0.lock().unwrap() = kind.to_string();
        snap::install(app, window);
    }
    #[cfg(not(windows))]
    let _ = (app, window);
}

pub fn toggle_maximize(w: &WebviewWindow) {
    let _ = if w.is_maximized().unwrap_or(false) { w.unmaximize() } else { w.maximize() };
}

/// Snap-layout state of one window: the maximize button rect (top-level client physical px:
/// x, y, w, h), its overlay child window, whether the cursor is over it, and the window label
/// the hover event is addressed to.
#[derive(Default, Debug, Clone, PartialEq)]
pub struct SnapState {
    pub rect: [i32; 4],
    pub overlay: isize,
    pub hover: bool,
    pub label: String,
}

impl SnapState {
    pub fn hits(&self, x: i32, y: i32) -> bool {
        let [rx, ry, w, h] = self.rect;
        w > 0 && x >= rx && x < rx + w && y >= ry && y < ry + h
    }
}

/// HWND -> state.
pub struct SnapMap(std::sync::Mutex<std::collections::BTreeMap<isize, SnapState>>);

impl SnapMap {
    pub const fn new() -> Self {
        SnapMap(std::sync::Mutex::new(std::collections::BTreeMap::new()))
    }
    pub fn with<R>(&self, hwnd: isize, f: impl FnOnce(&mut SnapState) -> R) -> Option<R> {
        self.0.lock().unwrap().get_mut(&hwnd).map(f)
    }
    pub fn insert(&self, hwnd: isize, st: SnapState) {
        self.0.lock().unwrap().insert(hwnd, st);
    }
    pub fn remove(&self, hwnd: isize) {
        self.0.lock().unwrap().remove(&hwnd);
    }
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.0.lock().unwrap().len()
    }
}

#[cfg(windows)]
mod snap {
    use super::*;
    use std::sync::OnceLock;
    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT};
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::*;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static STATES: SnapMap = SnapMap::new();

    fn hwnd_of(w: &WebviewWindow) -> Option<HWND> {
        w.hwnd().ok().map(|h| HWND(h.0 as _))
    }

    pub fn install(app: &AppHandle, window: &WebviewWindow) {
        let Some(top) = hwnd_of(window) else { return };
        let _ = APP.set(app.clone());
        let mut st = SnapState { label: window.label().to_string(), ..Default::default() };
        unsafe {
            let hinst = GetModuleHandleW(None).unwrap_or_default();
            let class = w!("QuireSnapOverlay");
            let wc = WNDCLASSW { lpfnWndProc: Some(overlay_proc), hInstance: hinst.into(), lpszClassName: class, ..Default::default() };
            RegisterClassW(&wc); // fails harmlessly when an earlier window registered it
            if let Ok(ov) = CreateWindowExW(WS_EX_LAYERED | WS_EX_NOACTIVATE, class, None, WS_CHILD | WS_CLIPSIBLINGS, 0, 0, 0, 0, Some(top), None, Some(hinst.into()), None) {
                // alpha 1/255: effectively invisible, but avoids an unpainted hole.
                let _ = SetLayeredWindowAttributes(ov, COLORREF(0), 1, LWA_ALPHA);
                st.overlay = ov.0 as isize;
            }
            STATES.insert(top.0 as isize, st);
            let _ = SetWindowSubclass(top, Some(top_proc), 1, 0);
        }
    }

    /// `x,y,w,h` in CSS px relative to the webview (== client area). `w == 0` disables.
    pub fn set_rect(window: &WebviewWindow, x: f64, y: f64, w: f64, h: f64) {
        let Some(top) = hwnd_of(window) else { return };
        let s = window.scale_factor().unwrap_or(1.0);
        let r = [(x * s).round() as i32, (y * s).round() as i32, (w * s).round() as i32, (h * s).round() as i32];
        let Some(ov) = STATES.with(top.0 as isize, |st| {
            st.rect = r;
            st.overlay
        }) else {
            return;
        };
        if ov == 0 {
            return;
        }
        let ov = HWND(ov as _);
        unsafe {
            if r[2] <= 0 || r[3] <= 0 {
                let _ = ShowWindow(ov, SW_HIDE);
            } else {
                let _ = SetWindowPos(ov, Some(HWND_TOP), r[0], r[1], r[2], r[3], SWP_NOACTIVATE | SWP_SHOWWINDOW);
            }
        }
    }

    fn emit_hover(label: &str, v: bool) {
        if let Some(app) = APP.get() {
            let _ = MaxButtonHover(v).emit_to(app, label);
        }
    }

    unsafe extern "system" fn overlay_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if msg == WM_NCHITTEST {
            return LRESULT(HTTRANSPARENT as isize);
        }
        DefWindowProcW(hwnd, msg, wp, lp)
    }

    unsafe extern "system" fn top_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
        let key = hwnd.0 as isize;
        match msg {
            WM_NCHITTEST => {
                let mut pt = POINT { x: (lp.0 & 0xFFFF) as i16 as i32, y: ((lp.0 >> 16) & 0xFFFF) as i16 as i32 };
                let _ = ScreenToClient(hwnd, &mut pt);
                if STATES.with(key, |st| st.hits(pt.x, pt.y)).unwrap_or(false) {
                    return LRESULT(HTMAXBUTTON as isize);
                }
            }
            WM_NCMOUSEMOVE if wp.0 as u32 == HTMAXBUTTON => {
                if let Some((was, label)) = STATES.with(key, |st| (std::mem::replace(&mut st.hover, true), st.label.clone())) {
                    if !was {
                        emit_hover(&label, true);
                    }
                }
                let mut t = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE | TME_NONCLIENT, hwndTrack: hwnd, dwHoverTime: 0 };
                let _ = TrackMouseEvent(&mut t);
            }
            WM_NCMOUSELEAVE => {
                if let Some((was, label)) = STATES.with(key, |st| (std::mem::replace(&mut st.hover, false), st.label.clone())) {
                    if was {
                        emit_hover(&label, false);
                    }
                }
            }
            WM_NCLBUTTONDOWN if wp.0 as u32 == HTMAXBUTTON => return LRESULT(0),
            WM_NCLBUTTONUP if wp.0 as u32 == HTMAXBUTTON => {
                let _ = ShowWindow(hwnd, if IsZoomed(hwnd).as_bool() { SW_RESTORE } else { SW_MAXIMIZE });
                return LRESULT(0);
            }
            WM_NCDESTROY => {
                STATES.remove(key);
                let _ = RemoveWindowSubclass(hwnd, Some(top_proc), 1);
            }
            _ => {}
        }
        DefSubclassProc(hwnd, msg, wp, lp)
    }
}

pub fn set_maxbtn_rect(window: &WebviewWindow, x: f64, y: f64, w: f64, h: f64) {
    #[cfg(windows)]
    snap::set_rect(window, x, y, w, h);
    #[cfg(not(windows))]
    let _ = (window, x, y, w, h);
}

/// Monitors as physical rects, primary first.
pub fn monitor_rects(app: &AppHandle) -> Vec<crate::session::Rect> {
    let rect = |m: &tauri::Monitor| crate::session::Rect { x: m.position().x, y: m.position().y, w: m.size().width, h: m.size().height };
    let mut v: Vec<_> = app.primary_monitor().ok().flatten().iter().map(rect).collect();
    for m in app.available_monitors().unwrap_or_default() {
        let r = rect(&m);
        if !v.contains(&r) {
            v.push(r);
        }
    }
    v
}

/// A window's position (outer) and size (inner, which is what `set_size` takes: no growth on restore), physical px.
pub fn outer_rect(w: &WebviewWindow) -> Option<crate::session::Rect> {
    let (p, s) = (w.outer_position().ok()?, w.inner_size().ok()?);
    Some(crate::session::Rect { x: p.x, y: p.y, w: s.width, h: s.height })
}

/// Move a window back on screen if the monitor it was saved on is gone or it hangs off the edge.
pub fn ensure_on_screen(app: &AppHandle, w: &WebviewWindow) {
    if w.is_maximized().unwrap_or(false) || w.is_fullscreen().unwrap_or(false) || w.is_minimized().unwrap_or(false) {
        return;
    }
    let Some(cur) = outer_rect(w) else { return };
    let fixed = crate::session::clamp_to_monitors(cur, &monitor_rects(app));
    if fixed != cur {
        let _ = w.set_size(tauri::PhysicalSize::new(fixed.w, fixed.h));
        let _ = w.set_position(tauri::PhysicalPosition::new(fixed.x, fixed.y));
    }
}

/// Bring a window to the front, restoring it from the taskbar if minimised.
pub fn focus(w: &WebviewWindow) {
    let _ = w.show();
    if w.is_minimized().unwrap_or(false) {
        let _ = w.unminimize();
    }
    let _ = w.set_focus();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snap_state_is_per_window() {
        let m = SnapMap::new();
        let st = |l: &str| SnapState { label: l.into(), ..Default::default() };
        m.insert(1, st("main"));
        m.insert(2, st("reader-1"));
        m.with(1, |s| s.rect = [100, 0, 46, 32]);
        m.with(2, |s| s.hover = true);
        assert!(m.with(1, |s| s.hits(120, 10)).unwrap());
        assert!(!m.with(2, |s| s.hits(120, 10)).unwrap(), "window 2 has no rect of its own");
        assert!(!m.with(1, |s| s.hover).unwrap());
        assert!(!m.with(1, |s| s.hits(146, 10)).unwrap(), "right edge is exclusive");
        m.remove(1);
        assert_eq!(m.len(), 1);
        assert!(m.with(1, |s| s.hover).is_none());
        assert_eq!(m.with(2, |s| s.label.clone()).unwrap(), "reader-1");
    }
}
