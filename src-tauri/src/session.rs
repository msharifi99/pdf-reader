//! Multi-window bookkeeping: which window shows which book, which was focused last, and the
//! session snapshot saved on quit (restored on launch). Pure logic, no Tauri types, so it is
//! unit-tested here; `multiwin.rs` does the actual window work.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub const MAIN: &str = "main";
/// The key in the settings table holding the serialised [`Session`].
pub const SESSION_KEY: &str = "windowSession";
/// Settings key (JSON bool, default true) that turns session restore off.
pub const RESTORE_KEY: &str = "restoreSession";

/// Physical pixels, virtual-desktop coordinates.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// One open window. The reading position is not stored here: the reader already saves it per book
/// through `save_progress`, and reopening the book resumes from it.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WinRec {
    pub label: String,
    pub book_id: Option<String>,
    pub bounds: Rect,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct Session {
    pub version: u32,
    pub windows: Vec<WinRec>,
}

impl Session {
    pub fn new(windows: Vec<WinRec>) -> Self {
        Session { version: 1, windows }
    }
    /// Anything unreadable (corrupt, newer version) is an empty session, never an error.
    pub fn parse(json: &serde_json::Value) -> Session {
        serde_json::from_value::<Session>(json.clone()).ok().filter(|s| s.version == 1).unwrap_or_default()
    }
    pub fn main(&self) -> Option<&WinRec> {
        self.windows.iter().find(|w| w.label == MAIN)
    }
}

/// Bounds to save for a window: while maximized the live rect is the whole work area, so the remembered
/// normal rect is saved instead (restoring maximizes on top of it, and un-maximizing returns to it).
pub fn bounds_to_save(maximized: bool, normal: Option<Rect>, live: Option<Rect>) -> Option<Rect> {
    if maximized { normal.or(live) } else { live }
}

/// Move `r` onto the visible desktop: pick the monitor it overlaps most (the first, i.e. primary,
/// when it overlaps none: its monitor was unplugged), shrink it to fit, and slide it inside.
pub fn clamp_to_monitors(r: Rect, monitors: &[Rect]) -> Rect {
    let overlap = |m: &Rect| {
        let w = (r.x as i64 + r.w as i64).min(m.x as i64 + m.w as i64) - (r.x as i64).max(m.x as i64);
        let h = (r.y as i64 + r.h as i64).min(m.y as i64 + m.h as i64) - (r.y as i64).max(m.y as i64);
        if w > 0 && h > 0 {
            w * h
        } else {
            0
        }
    };
    let Some(first) = monitors.first() else { return r };
    let m = monitors.iter().max_by_key(|m| overlap(m)).filter(|m| overlap(m) > 0).unwrap_or(first);
    let (w, h) = (r.w.min(m.w), r.h.min(m.h));
    let x = (r.x as i64).clamp(m.x as i64, m.x as i64 + (m.w - w) as i64) as i32;
    let y = (r.y as i64).clamp(m.y as i64, m.y as i64 + (m.h - h) as i64) as i32;
    Rect { x, y, w, h }
}

#[derive(Default)]
struct Inner {
    /// label -> book shown (None: library)
    books: HashMap<String, Option<String>>,
    /// label -> focus tick; higher is more recent
    focus: HashMap<String, u64>,
    /// label -> last bounds while neither maximized, minimized nor fullscreen
    normal: HashMap<String, Rect>,
    tick: u64,
    next: u32,
}

/// Open windows, their books and focus order. One per app.
#[derive(Default)]
pub struct Registry(Mutex<Inner>);

impl Registry {
    pub fn add(&self, label: &str) {
        self.0.lock().unwrap().books.entry(label.to_string()).or_default();
    }
    pub fn remove(&self, label: &str) {
        let mut g = self.0.lock().unwrap();
        g.books.remove(label);
        g.focus.remove(label);
        g.normal.remove(label);
    }
    pub fn set_normal(&self, label: &str, r: Rect) {
        self.0.lock().unwrap().normal.insert(label.to_string(), r);
    }
    pub fn normal(&self, label: &str) -> Option<Rect> {
        self.0.lock().unwrap().normal.get(label).copied()
    }
    pub fn focus(&self, label: &str) {
        let mut g = self.0.lock().unwrap();
        g.tick += 1;
        let t = g.tick;
        g.focus.insert(label.to_string(), t);
        g.books.entry(label.to_string()).or_default();
    }
    pub fn set_book(&self, label: &str, book: Option<String>) {
        self.0.lock().unwrap().books.insert(label.to_string(), book);
    }
    pub fn book_of(&self, label: &str) -> Option<String> {
        self.0.lock().unwrap().books.get(label).cloned().flatten()
    }
    /// The window currently showing `book`, if any (the most recently focused when several).
    pub fn window_showing(&self, book: &str) -> Option<String> {
        let g = self.0.lock().unwrap();
        g.books
            .iter()
            .filter(|(_, b)| b.as_deref() == Some(book))
            .max_by_key(|(l, _)| g.focus.get(*l).copied().unwrap_or(0))
            .map(|(l, _)| l.clone())
    }
    /// The most recently focused open window (the main one if none was ever focused).
    pub fn most_recent(&self) -> Option<String> {
        let g = self.0.lock().unwrap();
        g.books.keys().max_by_key(|l| (g.focus.get(*l).copied().unwrap_or(0), *l == MAIN)).cloned()
    }
    /// A fresh `reader-<n>` label.
    pub fn next_label(&self) -> String {
        let mut g = self.0.lock().unwrap();
        loop {
            g.next += 1;
            let l = format!("reader-{}", g.next);
            if !g.books.contains_key(&l) {
                return l;
            }
        }
    }
    /// Keep future labels clear of `reader-<n>` labels restored from a session.
    pub fn reserve(&self, label: &str) {
        if let Some(n) = label.strip_prefix("reader-").and_then(|n| n.parse::<u32>().ok()) {
            let mut g = self.0.lock().unwrap();
            g.next = g.next.max(n);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const M1: Rect = Rect { x: 0, y: 0, w: 1920, h: 1080 };
    const M2: Rect = Rect { x: 1920, y: 0, w: 2560, h: 1440 };

    #[test]
    fn session_round_trips_and_tolerates_junk() {
        let s = Session::new(vec![
            WinRec { label: "main".into(), book_id: Some("b1".into()), bounds: Rect { x: 10, y: 20, w: 1280, h: 800 }, maximized: true },
            WinRec { label: "reader-2".into(), book_id: None, bounds: M1, maximized: false },
        ]);
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["windows"][0]["bookId"], "b1");
        assert_eq!(Session::parse(&v), s);
        assert_eq!(s.main().unwrap().book_id.as_deref(), Some("b1"));
        assert!(Session::parse(&serde_json::json!({"version": 9, "windows": []})).windows.is_empty());
        assert!(Session::parse(&serde_json::json!("nope")).windows.is_empty());
        // a record without `maximized` still loads
        let old = serde_json::json!({"version":1,"windows":[{"label":"main","bookId":null,"bounds":{"x":0,"y":0,"w":800,"h":600}}]});
        assert_eq!(Session::parse(&old).windows.len(), 1);
    }

    #[test]
    fn clamp_keeps_visible_windows_and_rescues_lost_ones() {
        let ok = Rect { x: 100, y: 100, w: 1280, h: 800 };
        assert_eq!(clamp_to_monitors(ok, &[M1, M2]), ok);
        // saved on a second monitor that is gone: lands on the primary, slid inside
        let lost = Rect { x: 2500, y: 200, w: 1280, h: 800 };
        assert_eq!(clamp_to_monitors(lost, &[M1]), Rect { x: 640, y: 200, w: 1280, h: 800 });
        // hangs off the edge: slides back in
        assert_eq!(clamp_to_monitors(Rect { x: 1500, y: 700, w: 1280, h: 800 }, &[M1]), Rect { x: 640, y: 280, w: 1280, h: 800 });
        // larger than the monitor: shrinks
        assert_eq!(clamp_to_monitors(Rect { x: -50, y: -50, w: 4000, h: 3000 }, &[M1]), M1);
        // overlapping the right-hand monitor most keeps it there
        assert!(clamp_to_monitors(Rect { x: 1900, y: 0, w: 1000, h: 800 }, &[M1, M2]).x >= 1920);
        assert_eq!(clamp_to_monitors(ok, &[]), ok);
    }

    #[test]
    fn a_maximized_window_saves_its_normal_bounds() {
        let normal = Rect { x: 100, y: 100, w: 1280, h: 800 };
        assert_eq!(bounds_to_save(true, Some(normal), Some(M1)), Some(normal));
        assert_eq!(bounds_to_save(true, None, Some(M1)), Some(M1));
        assert_eq!(bounds_to_save(false, Some(normal), Some(M2)), Some(M2));
        let r = Registry::default();
        r.set_normal("w", normal);
        assert_eq!(r.normal("w"), Some(normal));
        r.remove("w");
        assert_eq!(r.normal("w"), None);
    }

    #[test]
    fn registry_tracks_books_focus_and_labels() {
        let r = Registry::default();
        r.add("main");
        r.focus("main");
        r.set_book("main", Some("a".into()));
        r.add("reader-1");
        r.set_book("reader-1", Some("b".into()));
        assert_eq!(r.window_showing("b").as_deref(), Some("reader-1"));
        assert_eq!(r.window_showing("zzz"), None);
        assert_eq!(r.most_recent().as_deref(), Some("main"));
        r.focus("reader-1");
        assert_eq!(r.most_recent().as_deref(), Some("reader-1"));
        assert_eq!(r.book_of("reader-1").as_deref(), Some("b"));
        r.remove("reader-1");
        assert_eq!(r.window_showing("b"), None);
        assert_eq!(r.most_recent().as_deref(), Some("main"));
        r.reserve("reader-7");
        assert_eq!(r.next_label(), "reader-8");
        assert_eq!(r.next_label(), "reader-9");
    }
}
