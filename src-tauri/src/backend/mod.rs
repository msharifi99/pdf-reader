//! Quire's backend core: library DB, ingestion, progress, annotations, settings, backup.
//! Everything here works without a Tauri runtime (`Core::new(dir, emitter)`); `commands.rs` is
//! the thin IPC layer on top.

pub mod backup;
pub mod commands;
pub mod db;
pub mod error;
pub mod files;
pub mod fonts;
pub mod index;
pub mod model;
pub mod ocr;
pub mod raw;
pub mod watcher;

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri_specta::Event;

pub use db::Db;
use error::{Error, ErrorCode, Res};
use model::*;

/// Fired when books were added, re-linked, or changed availability. Payload: book ids.
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type, Event)]
pub struct LibraryChanged(pub Vec<String>);

/// Watched-folder scan progress.
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type, Event)]
pub struct IngestProgress {
    pub done: i32,
    pub total: i32,
}

/// The database and covers were replaced by `restore`: reload everything.
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type, Event)]
pub struct BackupRestored(pub bool);

/// A setting was written (by any window): every webview re-reads that key so windows stay in sync.
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type, Event)]
pub struct SettingsChanged {
    pub key: String,
    pub value: Json,
}

/// Indexing progress (also fires when a book starts/finishes). `current` is the book being indexed.
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgress {
    pub done: u32,
    pub total: u32,
    pub failed: u32,
    pub current: Option<String>,
}

/// Core -> indexer window: `paused` is true while the user is reading.
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type, Event)]
pub struct IndexControl {
    pub paused: bool,
}

#[derive(Debug, Clone)]
pub enum CoreEvent {
    IndexProgress { done: u32, total: u32, failed: u32, current: Option<String> },
    IndexControl { paused: bool },
    LibraryChanged(Vec<String>),
    IngestProgress { done: i32, total: i32 },
    BackupRestored,
    SettingsChanged { key: String, value: Json },
}

pub type Emitter = Arc<dyn Fn(CoreEvent) + Send + Sync>;

pub struct Core {
    pub db: Db,
    pub emit: Emitter,
    watching: Mutex<Option<watcher::Watching>>,
    /// The main window has a book open: the indexer stays paused.
    pub reading: AtomicBool,
}

impl Core {
    pub fn new(dir: &Path, emit: Emitter) -> Res<Core> {
        Ok(Core { db: Db::open(dir)?, emit, watching: Mutex::new(None), reading: AtomicBool::new(false) })
    }

    /// App launch: housekeeping, availability check and (re)scan + watch of all watched folders, off-thread.
    pub fn start(self: &Arc<Self>) {
        let me = self.clone();
        std::thread::spawn(move || {
            let _ = me.db.purge_deleted_annotations(model::now_ms() - 30.0 * 86_400_000.0);
            if let Ok(ids) = me.db.refresh_availability() {
                if !ids.is_empty() { (me.emit)(CoreEvent::LibraryChanged(ids)); }
            }
            let _ = me.restart_watching(true);
        });
    }

    fn roots(&self) -> Vec<PathBuf> {
        self.db.list_watched_folders().unwrap_or_default().into_iter().map(PathBuf::from).collect()
    }

    /// Rebuild the OS watcher; optionally rescan every folder (blocking: call from a worker thread).
    fn restart_watching(&self, rescan: bool) -> Res<()> {
        let roots = self.roots();
        *self.watching.lock().unwrap() = None;
        *self.watching.lock().unwrap() = Some(watcher::watch(&self.db, &self.emit, &roots)?);
        if rescan {
            for r in roots.iter().filter(|r| r.is_dir()) {
                let _ = watcher::scan_folder(&self.db, &self.emit, r);
            }
        }
        Ok(())
    }

    pub fn open_document(&self, path: &str) -> Res<OpenedDocument> {
        let r = self.db.register(Path::new(path), true)?.ok_or_else(|| Error::not_found("that file"))?;
        let progress = self.db.get_progress(&r.book.id)?;
        Ok(OpenedDocument { book: r.book, progress, start_image: r.start_image.map(|p| p.to_string_lossy().into_owned()), created: r.created })
    }

    pub fn add_watched_folder(self: &Arc<Self>, path: &str) -> Res<()> {
        let p = std::fs::canonicalize(path)?;
        if !p.is_dir() {
            return Err(Error::new(ErrorCode::Invalid, "That isn't a folder."));
        }
        self.db.add_watched_folder(&db::strip_verbatim(&p).to_string_lossy())?;
        let me = self.clone();
        std::thread::spawn(move || { let _ = me.restart_watching(true); });
        Ok(())
    }

    pub fn remove_watched_folder(self: &Arc<Self>, path: &str) -> Res<()> {
        self.db.remove_watched_folder(path)?;
        let me = self.clone();
        std::thread::spawn(move || { let _ = me.restart_watching(false); });
        Ok(())
    }

    pub fn rescan_watched_folders(self: &Arc<Self>) {
        let me = self.clone();
        std::thread::spawn(move || { let _ = me.restart_watching(true); });
    }

    pub fn restore(self: &Arc<Self>, src: &Path) -> Res<()> {
        *self.watching.lock().unwrap() = None;
        let r = self.db.restore(src);
        let me = self.clone();
        std::thread::spawn(move || { let _ = me.restart_watching(true); });
        r?;
        (self.emit)(CoreEvent::BackupRestored);
        Ok(())
    }
}
