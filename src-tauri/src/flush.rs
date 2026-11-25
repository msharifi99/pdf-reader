//! Shutdown flush handshake (story 114). Debounced writes (reading position, settings, annotation edits)
//! live in the webview, so when a window is asked to close the core first tells it to flush, waits for its
//! `flush_done` (at most [`WAIT_MS`], a hung webview never blocks quitting), then lets the close go through.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_specta::Event;

pub const WAIT_MS: u64 = 1500;

/// Core -> one window: write everything pending now, then call `flush_done`.
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type, Event)]
pub struct FlushRequest(pub bool);

#[derive(Default)]
pub struct Flush(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    waiting: HashSet<String>,
    done: HashSet<String>,
    allowed: HashSet<String>,
}

impl Flush {
    /// First close request of a window: true = hold the close and flush first; false = the flush
    /// already happened, let it close. While a flush is under way further requests are held too.
    pub fn begin(&self, label: &str) -> Begin {
        let mut g = self.0.lock().unwrap();
        if g.allowed.remove(label) {
            Begin::Proceed
        } else if g.waiting.contains(label) {
            Begin::AlreadyWaiting
        } else {
            g.waiting.insert(label.to_string());
            g.done.remove(label);
            Begin::Flush
        }
    }
    pub fn done(&self, label: &str) {
        self.0.lock().unwrap().done.insert(label.to_string());
    }
    fn is_done(&self, label: &str) -> bool {
        self.0.lock().unwrap().done.contains(label)
    }
    fn finish(&self, label: &str) {
        let mut g = self.0.lock().unwrap();
        g.waiting.remove(label);
        g.allowed.insert(label.to_string());
    }
    /// Block until the window answered or `max` passed.
    pub fn wait(&self, label: &str, max: Duration) -> bool {
        let t = Instant::now();
        while t.elapsed() < max {
            if self.is_done(label) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        self.is_done(label)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Begin {
    Flush,
    AlreadyWaiting,
    Proceed,
}

/// Ask `label` to flush, then close it for real (off-thread; the close request that started this was held).
pub fn flush_then_close(app: &AppHandle, label: &str) {
    let _ = FlushRequest(true).emit_to(app, label);
    let (app, label) = (app.clone(), label.to_string());
    std::thread::spawn(move || {
        let flush = app.state::<Flush>();
        flush.wait(&label, Duration::from_millis(WAIT_MS));
        flush.finish(&label);
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.close();
        }
    });
}

/// The window's webview finished writing what it had pending.
#[tauri::command]
#[specta::specta]
pub fn flush_done(window: WebviewWindow, st: State<Flush>) {
    st.done(window.label());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_flushes_once_then_closes_and_a_silent_one_times_out() {
        let f = Flush::default();
        assert_eq!(f.begin("a"), Begin::Flush);
        assert_eq!(f.begin("a"), Begin::AlreadyWaiting);
        f.done("a");
        assert!(f.wait("a", Duration::from_millis(50)));
        f.finish("a");
        assert_eq!(f.begin("a"), Begin::Proceed);
        assert_eq!(f.begin("a"), Begin::Flush); // a later close asks again
        assert!(!f.wait("a", Duration::from_millis(60)), "no answer: gives up, the close still goes ahead");
    }
}
