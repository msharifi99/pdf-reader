//! Frameless window plumbing: Mica backdrop, window-control commands, Windows 11 snap layouts.
//!
//! Snap layouts: Windows shows the snap flyout when the top-level window's `WM_NCHITTEST`
//! returns `HTMAXBUTTON` for the cursor. The WebView2 child windows live in another process,
//! so we cannot subclass them and they swallow the hit test. Instead we (1) subclass the
//! top-level window to answer `HTMAXBUTTON` inside the HTML maximize button's rect, and
//! (2) park a tiny invisible child window of our own, same thread, on top of the webview over
//! that rect; it answers `HTTRANSPARENT`, which makes the hit test fall through to its
//! parent (the top-level window). The frontend reports the button rect via
//! `window_set_maxbtn_rect`, and receives `MaxButtonHover` events because the webview no
//! longer sees the mouse over that rect (so it must draw the hover state itself).

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

#[cfg(windows)]
mod snap {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::sync::{Mutex, OnceLock};
    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT};
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::*;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static OVERLAY: AtomicIsize = AtomicIsize::new(0);
    static HOVER: AtomicBool = AtomicBool::new(false);
    /// Maximize button rect in top-level client physical pixels: x, y, w, h.
    static RECT: Mutex<[i32; 4]> = Mutex::new([0; 4]);

    fn hwnd_of(w: &WebviewWindow) -> Option<HWND> {
        w.hwnd().ok().map(|h| HWND(h.0 as _))
    }

    pub fn install(app: &AppHandle, window: &WebviewWindow) {
        let Some(top) = hwnd_of(window) else { return };
        let _ = APP.set(app.clone());
        unsafe {
            let _ = SetWindowSubclass(top, Some(top_proc), 1, 0);
            let hinst = GetModuleHandleW(None).unwrap_or_default();
            let class = w!("QuireSnapOverlay");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(overlay_proc),
                hInstance: hinst.into(),
                lpszClassName: class,
                ..Default::default()
            };
            RegisterClassW(&wc);
            if let Ok(ov) = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_NOACTIVATE,
                class,
                None,
                WS_CHILD | WS_CLIPSIBLINGS,
                0, 0, 0, 0,
                Some(top),
                None,
                Some(hinst.into()),
                None,
            ) {
                // alpha 1/255: effectively invisible, but avoids an unpainted hole.
                let _ = SetLayeredWindowAttributes(ov, COLORREF(0), 1, LWA_ALPHA);
                OVERLAY.store(ov.0 as isize, Ordering::SeqCst);
            }
        }
    }

    /// `x,y,w,h` in CSS px relative to the webview (== client area). `w == 0` disables.
    pub fn set_rect(window: &WebviewWindow, x: f64, y: f64, w: f64, h: f64) {
        let s = window.scale_factor().unwrap_or(1.0);
        let r = [(x * s).round() as i32, (y * s).round() as i32, (w * s).round() as i32, (h * s).round() as i32];
        *RECT.lock().unwrap() = r;
        let ov = OVERLAY.load(Ordering::SeqCst);
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

    fn emit_hover(v: bool) {
        if let Some(app) = APP.get() {
            let _ = MaxButtonHover(v).emit(app);
        }
    }

    unsafe extern "system" fn overlay_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if msg == WM_NCHITTEST {
            return LRESULT(HTTRANSPARENT as isize);
        }
        DefWindowProcW(hwnd, msg, wp, lp)
    }

    unsafe extern "system" fn top_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
        match msg {
            WM_NCHITTEST => {
                let mut pt = POINT { x: (lp.0 & 0xFFFF) as i16 as i32, y: ((lp.0 >> 16) & 0xFFFF) as i16 as i32 };
                let _ = ScreenToClient(hwnd, &mut pt);
                let [x, y, w, h] = *RECT.lock().unwrap();
                if w > 0 && pt.x >= x && pt.x < x + w && pt.y >= y && pt.y < y + h {
                    return LRESULT(HTMAXBUTTON as isize);
                }
            }
            WM_NCMOUSEMOVE if wp.0 as u32 == HTMAXBUTTON => {
                if !HOVER.swap(true, Ordering::SeqCst) {
                    emit_hover(true);
                }
                let mut t = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE | TME_NONCLIENT,
                    hwndTrack: hwnd,
                    dwHoverTime: 0,
                };
                let _ = TrackMouseEvent(&mut t);
            }
            WM_NCMOUSELEAVE => {
                if HOVER.swap(false, Ordering::SeqCst) {
                    emit_hover(false);
                }
            }
            WM_NCLBUTTONDOWN if wp.0 as u32 == HTMAXBUTTON => return LRESULT(0),
            WM_NCLBUTTONUP if wp.0 as u32 == HTMAXBUTTON => {
                let _ = ShowWindow(hwnd, if IsZoomed(hwnd).as_bool() { SW_RESTORE } else { SW_MAXIMIZE });
                return LRESULT(0);
            }
            WM_NCDESTROY => {
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
