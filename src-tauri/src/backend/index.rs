//! Library-wide full-text index (FTS5) and the hidden indexer window that fills it.
//!
//! Flow: the `indexer` webview asks `books_needing_index`, opens each book with its Engine,
//! streams `textStream` chunks (~1-2 KB, each with a Locator) into `index_book_chunks`
//! (first batch replaces the book's old chunks, `done` seals the run) and moves on. The main
//! window tells the core when a book is being read (`set_reading_active`); the core relays that
//! as an `index-control` event so the indexer pauses.
//!
//! FTS5 content tables can't delete by an UNINDEXED column without a full scan, so every batch
//! records its rowid range in `index_ranges` and a re-index deletes by range.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use tauri::State;

use super::db::{get_book_c, Db};
use super::error::{Error, Res};
use super::model::*;
use super::{Core, CoreEvent};

/// Bump when the extractors or chunking change: every book is then re-indexed in the background.
pub const INDEX_VERSION: i32 = 1;
/// A failed book is not retried before this long has passed (or until `clear_index`).
const RETRY_FAILED_AFTER_MS: f64 = 24.0 * 3_600_000.0;
const MAX_HITS_PER_BOOK: u32 = 5;

#[derive(Debug, Clone, Deserialize, Type)]
pub struct Chunk {
    /// Where the chunk starts (an engine `Locator`).
    pub locator: Json,
    pub text: String,
}

#[derive(Debug, Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IndexState {
    Pending,
    Indexing,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BookIndex {
    pub book_id: String,
    pub state: IndexState,
    pub chunks: u32,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    /// Books fully indexed at the current extractor version.
    pub done: u32,
    /// Indexable books whose file is available.
    pub total: u32,
    pub failed: u32,
    /// The user is reading: the indexer is paused.
    pub paused: bool,
    pub books: Vec<BookIndex>,
}

/// Books the indexer cares about: visible, file present, and (for comics/images) only once OCR'd.
const INDEXABLE: &str = "b.removed=0 AND EXISTS(SELECT 1 FROM book_paths p WHERE p.book_id=b.id AND p.available=1) \
     AND (b.format NOT IN ('cbz','cbr','image') OR EXISTS(SELECT 1 FROM ocr_pages o WHERE o.book_id=b.id))";

/// Turn arbitrary user input into a safe FTS5 query. Bare words are ANDed, `"quoted text"` is a
/// phrase, the word being typed (last) matches as a prefix. Nothing from the input is ever passed
/// to FTS5 as syntax, so `"`, `-`, `AND(`, `*` or `NEAR(` can't raise errors.
pub fn fts_query(input: &str) -> Option<String> {
    let words = |s: &str| -> Vec<String> {
        s.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(|w| w.chars().take(64).collect()).collect()
    };
    let mut terms: Vec<String> = vec![];
    for (i, seg) in input.split('"').enumerate() {
        if i % 2 == 1 {
            let w = words(seg);
            if !w.is_empty() {
                terms.push(format!("\"{}\"", w.join(" ")));
            }
        } else {
            for piece in seg.split_whitespace() {
                let w = words(piece);
                if !w.is_empty() {
                    terms.push(format!("\"{}\"", w.join(" ")));
                }
            }
        }
    }
    terms.truncate(16);
    let open_phrase = input.matches('"').count() % 2 == 1;
    let typing = open_phrase || input.chars().last().is_some_and(|c| c.is_alphanumeric());
    let mut q = terms.join(" ");
    if q.is_empty() {
        return None;
    }
    if typing {
        q.push_str(" *"); // FTS5: prefix on the last token of the last phrase
        // `"a" "b" *` is parsed as `"a" AND ("b" *)`, which is what we want.
    }
    Some(q)
}

fn delete_chunks(t: &Transaction, book_id: &str) -> Res<()> {
    let ranges: Vec<(i64, i64)> = {
        let mut s = t.prepare("SELECT lo, hi FROM index_ranges WHERE book_id=?1")?;
        let v = s.query_map([book_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
        v
    };
    for (lo, hi) in ranges {
        t.execute("DELETE FROM text_index WHERE rowid BETWEEN ?1 AND ?2", [lo, hi])?;
    }
    t.execute("DELETE FROM index_ranges WHERE book_id=?1", [book_id])?;
    Ok(())
}

fn counts(c: &rusqlite::Connection) -> Res<(u32, u32, u32)> {
    Ok(c.query_row(
        &format!(
            "SELECT COUNT(*), COALESCE(SUM(s.state='done' AND s.version>=?1),0), COALESCE(SUM(s.state='failed'),0) \
             FROM books b LEFT JOIN index_state s ON s.book_id=b.id WHERE {INDEXABLE}"
        ),
        [INDEX_VERSION],
        |r| Ok((r.get(1)?, r.get(0)?, r.get(2)?)),
    )?)
}

impl Db {
    /// One batch of a book's index run. `first` starts a new run (drops the old chunks); `done`
    /// seals it. Rolled back as a whole on error.
    pub fn index_batch(&self, book_id: &str, chunks: &[Chunk], first: bool, done: bool) -> Res<()> {
        self.tx(|t| {
            let state: Option<String> = t.query_row("SELECT state FROM index_state WHERE book_id=?1", [book_id], |r| r.get(0)).optional()?;
            if first {
                delete_chunks(t, book_id)?;
                t.execute(
                    "INSERT INTO index_state(book_id,version,state,chunks,error,updated_at) VALUES(?1,?2,'indexing',0,NULL,?3) \
                     ON CONFLICT(book_id) DO UPDATE SET version=?2, state='indexing', chunks=0, error=NULL, updated_at=?3",
                    params![book_id, INDEX_VERSION, now_ms()],
                )
                .map_err(|_| Error::not_found("that book"))?;
            } else if state.as_deref() != Some("indexing") {
                return Err(Error::invalid("This book has no index run in progress; start one with first=true."));
            }
            let (mut lo, mut hi, mut n) = (0i64, 0i64, 0u32);
            {
                let mut s = t.prepare_cached("INSERT INTO text_index(book_id,locator,chunk) VALUES(?1,?2,?3)")?;
                for c in chunks.iter().filter(|c| !c.text.trim().is_empty()) {
                    s.execute(params![book_id, c.locator.0.to_string(), c.text.trim()])?;
                    hi = t.last_insert_rowid();
                    if n == 0 {
                        lo = hi;
                    }
                    n += 1;
                }
            }
            if n > 0 {
                t.execute("INSERT INTO index_ranges(book_id,lo,hi) VALUES(?1,?2,?3)", params![book_id, lo, hi])?;
            }
            t.execute(
                "UPDATE index_state SET chunks=chunks+?2, state=?3, updated_at=?4 WHERE book_id=?1",
                params![book_id, n, if done { "done" } else { "indexing" }, now_ms()],
            )?;
            Ok(())
        })
    }

    /// Replace a book's chunks in one go (tests, Rust-side extractors).
    pub fn index_chunks(&self, book_id: &str, chunks: &[(Value, String)]) -> Res<()> {
        let chunks: Vec<Chunk> = chunks.iter().map(|(l, t)| Chunk { locator: Json(l.clone()), text: t.clone() }).collect();
        self.index_batch(book_id, &chunks, true, true)
    }

    pub fn mark_index_failed(&self, book_id: &str, reason: &str) -> Res<()> {
        self.tx(|t| {
            delete_chunks(t, book_id)?;
            t.execute(
                "INSERT INTO index_state(book_id,version,state,chunks,error,updated_at) VALUES(?1,?2,'failed',0,?3,?4) \
                 ON CONFLICT(book_id) DO UPDATE SET version=?2, state='failed', chunks=0, error=?3, updated_at=?4",
                params![book_id, INDEX_VERSION, reason, now_ms()],
            )
            .map_err(|_| Error::not_found("that book"))?;
            Ok(())
        })
    }

    /// Forget a book's index: it becomes pending again (e.g. after OCR added text).
    pub fn clear_index(&self, book_id: &str) -> Res<()> {
        self.tx(|t| {
            delete_chunks(t, book_id)?;
            t.execute("DELETE FROM index_state WHERE book_id=?1", [book_id])?;
            Ok(())
        })
    }

    pub fn books_needing_index(&self, limit: u32) -> Res<Vec<Book>> {
        self.with(|c| {
            let sql = format!(
                "SELECT b.id FROM books b LEFT JOIN index_state s ON s.book_id=b.id WHERE {INDEXABLE} \
                 AND NOT (COALESCE(s.state,'')='done' AND s.version>=?1) \
                 AND NOT (COALESCE(s.state,'')='failed' AND s.version>=?1 AND s.updated_at>?2) \
                 ORDER BY b.last_opened_at IS NULL, b.last_opened_at DESC, b.added_at DESC LIMIT ?3"
            );
            let ids: Vec<String> = c
                .prepare(&sql)?
                .query_map(params![INDEX_VERSION, now_ms() - RETRY_FAILED_AFTER_MS, limit], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            ids.iter().map(|id| get_book_c(c, id)).collect()
        })
    }

    pub fn index_counts(&self) -> Res<(u32, u32, u32)> {
        self.with(counts)
    }

    pub fn index_status(&self, paused: bool) -> Res<IndexStatus> {
        self.with(|c| {
            let (done, total, failed) = counts(c)?;
            let sql = format!(
                "SELECT b.id, s.state, s.version, COALESCE(s.chunks,0), s.error FROM books b \
                 LEFT JOIN index_state s ON s.book_id=b.id WHERE {INDEXABLE} ORDER BY b.title COLLATE NOCASE"
            );
            let books = c
                .prepare(&sql)?
                .query_map([], |r| {
                    let state: Option<String> = r.get(1)?;
                    let version: Option<i32> = r.get(2)?;
                    let state = match (state.as_deref(), version) {
                        (Some("done"), Some(v)) if v >= INDEX_VERSION => IndexState::Done,
                        (Some("failed"), _) => IndexState::Failed,
                        (Some("indexing"), _) => IndexState::Indexing,
                        _ => IndexState::Pending,
                    };
                    Ok(BookIndex { book_id: r.get(0)?, state, chunks: r.get(3)?, error: r.get(4)? })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(IndexStatus { done, total, failed, paused, books })
        })
    }

    /// Ranked passages across the library: bm25 order, at most `MAX_HITS_PER_BOOK` per book so one
    /// long book can't bury the rest, `<mark>` around matches. Never errors on odd input.
    pub fn search_library_text(&self, query: &str, limit: u32) -> Res<Vec<TextHit>> {
        let Some(m) = fts_query(query) else { return Ok(vec![]) };
        self.with(|c| {
            let mut s = c.prepare_cached(
                "WITH hits AS (SELECT rowid AS rid, book_id AS bid, rank AS r FROM text_index WHERE text_index MATCH ?1), \
                      ranked AS (SELECT rid, r, ROW_NUMBER() OVER (PARTITION BY bid ORDER BY r) AS n FROM hits) \
                 SELECT t.book_id, b.title, t.locator, snippet(text_index, 2, '<mark>', '</mark>', '…', 24) \
                 FROM text_index t JOIN books b ON b.id=t.book_id \
                 WHERE text_index MATCH ?1 AND b.removed=0 AND t.rowid IN (SELECT rid FROM ranked WHERE n<=?3) \
                 ORDER BY rank LIMIT ?2",
            )?;
            let v = s
                .query_map(params![m, limit, MAX_HITS_PER_BOOK], |r| {
                    let loc: String = r.get(2)?;
                    Ok(TextHit {
                        book_id: r.get(0)?,
                        book_title: r.get(1)?,
                        locator: Json(serde_json::from_str(&loc).unwrap_or(Value::Null)),
                        snippet: r.get(3)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
    }
}

impl Core {
    /// Tell every window where indexing stands. `current` is the book being worked on, if any.
    pub fn emit_index_progress(&self, current: Option<String>) {
        if let Ok((done, total, failed)) = self.db.index_counts() {
            eprintln!("[indexer] {done}/{total} indexed, {failed} failed{}", current.as_deref().map(|c| format!(", working on {c}")).unwrap_or_default());
            (self.emit)(CoreEvent::IndexProgress { done, total, failed, current });
        }
    }

    pub fn set_reading_active(&self, active: bool) {
        if self.reading.swap(active, Ordering::SeqCst) != active {
            (self.emit)(CoreEvent::IndexControl { paused: active });
        }
    }
}

// ---- commands -------------------------------------------------------------------------------

type C<'a> = State<'a, Arc<Core>>;

/// Indexer only. Append a batch of chunks; `first` starts a new run for the book (dropping its old
/// chunks), `done` seals it. Emits `index-progress` on the first batch and when done.
#[tauri::command]
#[specta::specta]
pub async fn index_book_chunks(core: C<'_>, book_id: String, chunks: Vec<Chunk>, first: bool, done: bool) -> Res<()> {
    core.db.index_batch(&book_id, &chunks, first, done)?;
    if first || done {
        core.emit_index_progress((!done).then_some(book_id));
    }
    Ok(())
}

/// Indexed/pending per book plus a global done/total.
#[tauri::command]
#[specta::specta]
pub async fn index_status(core: C<'_>) -> Res<IndexStatus> {
    core.db.index_status(core.reading.load(Ordering::SeqCst))
}

/// Indexer only. Up to `limit` books that still need (re-)indexing, most recently opened first.
#[tauri::command]
#[specta::specta]
pub async fn books_needing_index(core: C<'_>, limit: u32) -> Res<Vec<Book>> {
    core.db.books_needing_index(limit)
}

/// Indexer only. Record that extracting `book_id` failed; it is not retried for a day.
#[tauri::command]
#[specta::specta]
pub async fn mark_index_failed(core: C<'_>, book_id: String, reason: String) -> Res<()> {
    core.db.mark_index_failed(&book_id, &reason)?;
    core.emit_index_progress(None);
    Ok(())
}

/// Drop a book's index so it is picked up again (call after OCR finishes).
#[tauri::command]
#[specta::specta]
pub async fn clear_index(core: C<'_>, book_id: String) -> Res<()> {
    core.db.clear_index(&book_id)?;
    core.emit_index_progress(None);
    Ok(())
}

/// Main window: a book is open and being read (`true`) or not (`false`). Pauses/resumes the indexer.
#[tauri::command]
#[specta::specta]
pub async fn set_reading_active(core: C<'_>, active: bool) -> Res<()> {
    core.set_reading_active(active);
    Ok(())
}

// ---- the hidden indexer window ----------------------------------------------------------------

/// Create the hidden `indexer` webview a few seconds after launch, so cold start is unaffected.
/// It never shows, never takes focus and has no taskbar button; it dies with the main window.
pub fn schedule_indexer(app: tauri::AppHandle, core: Arc<Core>, delay: std::time::Duration) {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        if core.db.get_setting("indexing.enabled").ok().flatten() == Some(Value::Bool(false)) || std::env::var_os("QUIRE_NO_INDEXER").is_some() {
            return;
        }
        let a = app.clone();
        let _ = app.run_on_main_thread(move || {
            if a.get_webview_window("main").is_none() || a.get_webview_window("indexer").is_some() {
                return;
            }
            let r = WebviewWindowBuilder::new(&a, "indexer", WebviewUrl::App("indexer.html".into()))
                .title("Quire indexer")
                .visible(false)
                .focused(false)
                .skip_taskbar(true)
                .decorations(false)
                .resizable(false)
                .inner_size(480.0, 360.0)
                .build();
            if let Err(e) = r {
                eprintln!("[indexer] couldn't start the indexer window: {e}");
            } else {
                eprintln!("[indexer] hidden indexer window started");
            }
        });
    });
}
