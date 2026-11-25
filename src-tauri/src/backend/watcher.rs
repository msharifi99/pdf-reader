//! Watched folders: initial recursive scan + debounced change events, all on worker threads.
//! Removing a file never deletes a Book: its path just becomes unavailable.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use notify_debouncer_full::notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use walkdir::WalkDir;

use super::db::{strip_verbatim, Db};
use super::error::{Error, ErrorCode, Res};
use super::files::is_doc_ext;
use super::{CoreEvent, Emitter};

type Debounce = Debouncer<notify_debouncer_full::notify::RecommendedWatcher, RecommendedCache>;

/// Keeps the OS watcher alive; dropping it stops the worker thread too.
pub struct Watching(#[allow(dead_code)] Debounce);

impl Db {
    /// path -> file_size for every available path (lets rescans skip unchanged files without hashing).
    fn known_available(&self) -> Res<HashMap<String, f64>> {
        self.with(|c| {
            let mut s = c.prepare("SELECT p.path, b.file_size FROM book_paths p JOIN books b ON b.id=p.book_id WHERE p.available=1")?;
            let v = s.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?.collect::<Result<HashMap<_, _>, _>>()?;
            Ok(v)
        })
    }
}

/// Wait until a file stops growing (a copy in progress), up to ~2 s.
fn wait_stable(p: &Path) {
    let mut last = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    for _ in 0..8 {
        std::thread::sleep(Duration::from_millis(250));
        let now = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        if now == last { return; }
        last = now;
    }
}

/// Walk `root`, ingest supported files, then reconcile availability. Emits progress + library-changed.
pub fn scan_folder(db: &Db, emit: &Emitter, root: &Path) -> Res<usize> {
    let files: Vec<PathBuf> = WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && is_doc_ext(e.path()))
        .map(|e| e.into_path())
        .collect();
    let known = db.known_available()?;
    let total = files.len() as i32;
    let mut changed = HashSet::new();
    let mut new = 0;
    for (i, f) in files.iter().enumerate() {
        let canon = std::fs::canonicalize(f).map(|c| strip_verbatim(&c).to_string_lossy().into_owned()).unwrap_or_default();
        let size = std::fs::metadata(f).map(|m| m.len() as f64).unwrap_or(-1.0);
        if known.get(&canon) != Some(&size) {
            if let Ok(Some(r)) = db.register(f, false) {
                if r.created { new += 1; }
                changed.insert(r.book.id);
            }
        }
        if (i + 1) % 5 == 0 || i + 1 == files.len() {
            emit(CoreEvent::IngestProgress { done: i as i32 + 1, total });
        }
        if changed.len() >= 25 {
            emit(CoreEvent::LibraryChanged(changed.drain().collect()));
        }
    }
    changed.extend(db.refresh_availability()?);
    if !changed.is_empty() {
        emit(CoreEvent::LibraryChanged(changed.into_iter().collect()));
    }
    Ok(new)
}

fn process_path(db: &Db, p: &Path, changed: &mut HashSet<String>) {
    if p.is_dir() {
        for e in WalkDir::new(p).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file() && is_doc_ext(e.path())) {
            if let Ok(Some(r)) = db.register(e.path(), false) { changed.insert(r.book.id); }
        }
    } else if p.is_file() {
        if is_doc_ext(p) {
            wait_stable(p);
            if let Ok(Some(r)) = db.register(p, false) { changed.insert(r.book.id); }
        }
    } else if let Ok(ids) = db.mark_unavailable(p) {
        changed.extend(ids);
    }
}

/// Start one debounced watcher over every folder in `roots` (missing folders are skipped).
pub fn watch(db: &Db, emit: &Emitter, roots: &[PathBuf]) -> Res<Watching> {
    let (tx, rx) = mpsc::channel::<DebounceEventResult>();
    let mut deb = new_debouncer(Duration::from_millis(600), None, move |res| { let _ = tx.send(res); })
        .map_err(|e| Error::new(ErrorCode::Io, format!("Couldn't watch folders ({e}).")))?;
    for r in roots.iter().filter(|r| r.is_dir()) {
        let _ = deb.watch(r, RecursiveMode::Recursive);
    }
    let (db, emit) = (db.clone(), emit.clone());
    std::thread::spawn(move || {
        // Ends when the debouncer (and its sender) is dropped.
        while let Ok(res) = rx.recv() {
            let Ok(events) = res else { continue };
            let mut paths = HashSet::new();
            for ev in events {
                paths.extend(ev.event.paths.iter().cloned());
            }
            let mut changed = HashSet::new();
            for p in paths { process_path(&db, &p, &mut changed); }
            if !changed.is_empty() {
                emit(CoreEvent::LibraryChanged(changed.into_iter().collect()));
            }
        }
    });
    Ok(Watching(deb))
}
