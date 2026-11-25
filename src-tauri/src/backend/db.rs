//! SQLite access: one connection behind a short-lived mutex (WAL, so readers never block on the
//! file; every write is its own transaction). Heavy work (hashing, extraction) happens outside it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::types::Value as Sql;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row, Transaction};
use serde_json::Value;

use super::error::{Error, Res};
use super::model::*;

pub const SCHEMA_VERSION: i32 = 2;

/// Each entry migrates from version `index` to `index + 1`. Never edit a shipped entry; append.
const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE books(
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  meta_user INTEGER NOT NULL DEFAULT 0,
  cover_path TEXT,
  cover_rev INTEGER NOT NULL DEFAULT 0,
  needs_cover INTEGER NOT NULL DEFAULT 1,
  page_count INTEGER,
  word_count INTEGER,
  status TEXT NOT NULL DEFAULT 'unread',
  added_at REAL NOT NULL,
  last_opened_at REAL,
  file_size REAL NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',
  removed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE book_paths(
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  last_seen_at REAL NOT NULL,
  available INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX book_paths_book ON book_paths(book_id);
CREATE TABLE collections(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at REAL NOT NULL
);
CREATE TABLE book_collections(
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY(book_id, collection_id)
);
CREATE TABLE progress(
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  locator TEXT NOT NULL,
  fraction REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE annotations(
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  color TEXT,
  anchor TEXT NOT NULL,
  pos REAL NOT NULL DEFAULT 0,
  note TEXT,
  label TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL
);
CREATE INDEX annotations_book ON annotations(book_id, pos);
CREATE TABLE reading_sessions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  started_at REAL NOT NULL,
  ended_at REAL,
  amount REAL,
  unit TEXT
);
CREATE TABLE watched_folders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  added_at REAL NOT NULL
);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE ocr_pages(
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  words TEXT NOT NULL,
  lang TEXT,
  created_at REAL NOT NULL,
  PRIMARY KEY(book_id, page)
);
CREATE VIRTUAL TABLE text_index USING fts5(
  book_id UNINDEXED, locator UNINDEXED, chunk,
  tokenize = 'unicode61 remove_diacritics 2'
);
"#, r#"
CREATE TABLE index_state(
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  state TEXT NOT NULL,
  chunks INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  updated_at REAL NOT NULL
);
CREATE TABLE index_ranges(
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  lo INTEGER NOT NULL,
  hi INTEGER NOT NULL
);
CREATE INDEX index_ranges_book ON index_ranges(book_id);
"#];

#[derive(Clone)]
pub struct Db {
    pub dir: PathBuf,
    conn: Arc<Mutex<Connection>>,
}

fn open_conn(path: &Path) -> Res<Connection> {
    let c = Connection::open(path)?;
    c.busy_timeout(std::time::Duration::from_secs(5))?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
    migrate(&c)?;
    Ok(c)
}

/// Idempotent: creates `schema_version` and applies pending migrations, each in a transaction.
pub fn migrate(c: &Connection) -> Res<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL)")?;
    let cur: i32 = c
        .query_row("SELECT COALESCE(MAX(version),0) FROM schema_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(cur as usize) {
        let tx = c.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute("DELETE FROM schema_version", [])?;
        tx.execute("INSERT INTO schema_version VALUES(?1)", [i as i32 + 1])?;
        tx.commit()?;
    }
    Ok(())
}

impl Db {
    pub fn open(dir: &Path) -> Res<Db> {
        std::fs::create_dir_all(dir.join("covers"))?;
        let conn = open_conn(&dir.join("quire.db"))?;
        Ok(Db { dir: dir.to_path_buf(), conn: Arc::new(Mutex::new(conn)) })
    }
    /// Fold the WAL into the main file (clean shutdown, before a backup copy).
    pub fn checkpoint(&self) {
        let _ = self.with(|c| Ok(c.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())).optional()?));
    }
    pub fn db_path(&self) -> PathBuf {
        self.dir.join("quire.db")
    }
    pub fn covers_dir(&self) -> PathBuf {
        self.dir.join("covers")
    }
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> Res<T>) -> Res<T> {
        let g = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        f(&g)
    }
    /// Run `f` in a transaction (committed on Ok).
    pub fn tx<T>(&self, f: impl FnOnce(&Transaction) -> Res<T>) -> Res<T> {
        let mut g = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let tx = g.transaction()?;
        let v = f(&tx)?;
        tx.commit()?;
        Ok(v)
    }
    /// Swap the live connection (used by restore). `f` gets the lock-held old connection's slot.
    pub fn replace_connection(&self, swap: impl FnOnce() -> Res<()>) -> Res<()> {
        let mut g = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        *g = Connection::open_in_memory()?; // drops (closes) the file connection
        let r = swap();
        *g = open_conn(&self.db_path())?;
        r
    }

    // ---- books ------------------------------------------------------------------------------

    pub fn get_book(&self, id: &str) -> Res<Book> {
        self.with(|c| get_book_c(c, id))
    }

    pub fn list_books(&self, q: &ListQuery) -> Res<Vec<Book>> {
        self.with(|c| {
            let mut args: Vec<Sql> = vec![];
            let mut wh = vec!["b.removed=0".to_string()];
            if !q.formats.is_empty() {
                let ph = vec!["?"; q.formats.len()].join(",");
                wh.push(format!("b.format IN ({ph})"));
                args.extend(q.formats.iter().map(|f| Sql::Text(f.as_str().into())));
            }
            if let Some(s) = q.status {
                wh.push("b.status=?".into());
                args.push(Sql::Text(s.as_str().into()));
            }
            if let Some(col) = &q.collection {
                wh.push("EXISTS(SELECT 1 FROM book_collections bc WHERE bc.book_id=b.id AND bc.collection_id=?)".into());
                args.push(Sql::Text(col.clone()));
            }
            if let Some(t) = &q.text {
                for w in t.split_whitespace() {
                    wh.push("(b.title LIKE ? ESCAPE '\\' OR b.author LIKE ? ESCAPE '\\')".into());
                    let pat = format!("%{}%", w.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
                    args.push(Sql::Text(pat.clone()));
                    args.push(Sql::Text(pat));
                }
            }
            let (nat, rev) = match q.sort {
                SortKey::Recent => (
                    "b.last_opened_at IS NULL, b.last_opened_at DESC, b.added_at DESC",
                    "b.last_opened_at IS NOT NULL, b.last_opened_at ASC, b.added_at ASC",
                ),
                SortKey::Added => ("b.added_at DESC", "b.added_at ASC"),
                SortKey::Title => ("b.title COLLATE NOCASE ASC", "b.title COLLATE NOCASE DESC"),
                SortKey::Author => (
                    "b.author='', b.author COLLATE NOCASE ASC, b.title COLLATE NOCASE ASC",
                    "b.author<>'', b.author COLLATE NOCASE DESC, b.title COLLATE NOCASE DESC",
                ),
                SortKey::Progress => (
                    "COALESCE(pr.fraction,0) DESC, b.last_opened_at DESC",
                    "COALESCE(pr.fraction,0) ASC, b.last_opened_at ASC",
                ),
            };
            let sql = format!(
                "SELECT {BOOK_COLS} {BOOK_FROM} WHERE {} ORDER BY {}",
                wh.join(" AND "),
                if q.reverse { rev } else { nat }
            );
            let mut books = c.prepare_cached(&sql)?.query_map(params_from_iter(args), row_to_book)?
                .collect::<Result<Vec<_>, _>>()?;
            fill_collections(c, &mut books)?;
            Ok(books)
        })
    }

    pub fn continue_reading(&self, limit: u32) -> Res<Vec<Book>> {
        self.with(|c| {
            let sql = format!(
                "SELECT {BOOK_COLS} {BOOK_FROM} WHERE b.removed=0 AND b.status='reading' \
                 ORDER BY b.last_opened_at DESC LIMIT ?1"
            );
            let mut books = c.prepare(&sql)?.query_map([limit], row_to_book)?.collect::<Result<Vec<_>, _>>()?;
            fill_collections(c, &mut books)?;
            Ok(books)
        })
    }

    /// Library-only removal: the row is hidden (progress/annotations are kept in case it comes back)
    /// and watched-folder scans won't re-add it. Opening the file again restores it.
    pub fn remove_book(&self, id: &str) -> Res<()> {
        self.tx(|t| {
            let n = t.execute("UPDATE books SET removed=1 WHERE id=?1", [id])?;
            if n == 0 { Err(Error::not_found("that book")) } else { Ok(()) }
        })
    }

    pub fn restore_book(&self, id: &str) -> Res<()> {
        self.tx(|t| {
            let n = t.execute("UPDATE books SET removed=0 WHERE id=?1", [id])?;
            if n == 0 { Err(Error::not_found("that book")) } else { Ok(()) }
        })
    }

    pub fn set_book_status(&self, id: &str, status: Status) -> Res<()> {
        self.tx(|t| {
            let n = t.execute("UPDATE books SET status=?2 WHERE id=?1", params![id, status.as_str()])?;
            if n == 0 { Err(Error::not_found("that book")) } else { Ok(()) }
        })
    }

    /// Shallow merge: keys in `patch` replace, `null` deletes. Returns the merged settings.
    pub fn set_book_settings(&self, id: &str, patch: &Value) -> Res<Value> {
        self.tx(|t| {
            let cur: String = t.query_row("SELECT settings FROM books WHERE id=?1", [id], |r| r.get(0))?;
            let mut cur: Value = serde_json::from_str(&cur).unwrap_or(Value::Object(Default::default()));
            if !cur.is_object() {
                cur = Value::Object(Default::default());
            }
            let Some(p) = patch.as_object() else { return Err(Error::invalid("Book settings must be an object.")) };
            let m = cur.as_object_mut().unwrap();
            for (k, v) in p {
                if v.is_null() { m.remove(k); } else { m.insert(k.clone(), v.clone()); }
            }
            t.execute("UPDATE books SET settings=?2 WHERE id=?1", params![id, cur.to_string()])?;
            Ok(cur)
        })
    }

    pub fn set_book_metadata(&self, id: &str, p: &MetadataPatch) -> Res<Book> {
        self.tx(|t| {
            let user_locked: bool = t.query_row("SELECT meta_user FROM books WHERE id=?1", [id], |r| r.get(0))?;
            if p.user || !user_locked {
                if let Some(v) = p.title.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                    t.execute("UPDATE books SET title=?2 WHERE id=?1", params![id, v])?;
                }
                if let Some(v) = &p.author {
                    t.execute("UPDATE books SET author=?2 WHERE id=?1", params![id, v.trim()])?;
                }
                if p.user {
                    t.execute("UPDATE books SET meta_user=1 WHERE id=?1", [id])?;
                }
            }
            if let Some(n) = p.page_count {
                t.execute("UPDATE books SET page_count=?2 WHERE id=?1", params![id, n])?;
            }
            if let Some(n) = p.word_count {
                t.execute("UPDATE books SET word_count=?2 WHERE id=?1", params![id, n])?;
            }
            get_book_c(t, id)
        })
    }

    /// Store a cover image (any web image format; the frontend sends WebP). Empty bytes mean
    /// "no cover possible": the book stops being reported by `books_needing_covers`.
    pub fn save_cover(&self, id: &str, bytes: &[u8], ext: &str) -> Res<()> {
        self.get_book(id)?;
        if bytes.is_empty() {
            return self.tx(|t| done(t.execute("UPDATE books SET needs_cover=0 WHERE id=?1", [id])));
        }
        let name = format!("{id}.{ext}");
        let dir = self.covers_dir();
        std::fs::create_dir_all(&dir)?;
        let tmp = dir.join(format!("{name}.tmp"));
        std::fs::write(&tmp, bytes)?;
        std::fs::rename(&tmp, dir.join(&name))?;
        self.tx(|t| {
            let old: Option<String> = t.query_row("SELECT cover_path FROM books WHERE id=?1", [id], |r| r.get(0))?;
            if let Some(old) = old.filter(|o| *o != name) {
                let _ = std::fs::remove_file(dir.join(old));
            }
            t.execute(
                "UPDATE books SET cover_path=?2, cover_rev=cover_rev+1, needs_cover=0 WHERE id=?1",
                params![id, name],
            )?;
            Ok(())
        })
    }

    pub fn cover_file(&self, id: &str) -> Option<PathBuf> {
        let name: Option<String> = self
            .with(|c| Ok(c.query_row("SELECT cover_path FROM books WHERE id=?1", [id], |r| r.get(0)).optional()?.flatten()))
            .ok()
            .flatten();
        name.map(|n| self.covers_dir().join(n))
    }

    pub fn books_needing_covers(&self) -> Res<Vec<Book>> {
        self.with(|c| {
            let sql = format!(
                "SELECT {BOOK_COLS} {BOOK_FROM} WHERE b.removed=0 AND b.needs_cover=1 AND \
                 EXISTS(SELECT 1 FROM book_paths p WHERE p.book_id=b.id AND p.available=1)"
            );
            let mut books = c.prepare(&sql)?.query_map([], row_to_book)?.collect::<Result<Vec<_>, _>>()?;
            fill_collections(c, &mut books)?;
            Ok(books)
        })
    }

    /// First available path for `/book/<id>` (never a hidden/unknown book).
    pub fn resolve_book_path(&self, id: &str) -> Option<PathBuf> {
        self.with(|c| {
            Ok(c.query_row(
                "SELECT path FROM book_paths WHERE book_id=?1 AND available=1 ORDER BY last_seen_at DESC LIMIT 1",
                [id],
                |r| r.get::<_, String>(0),
            )
            .optional()?)
        })
        .ok()
        .flatten()
        .map(PathBuf::from)
    }

    /// True if `path` is a known library file, or lies directly inside a known image-folder book.
    pub fn path_known(&self, path: &Path) -> bool {
        let p = strip_verbatim(path).to_string_lossy().into_owned();
        let parent = path.parent().map(|d| strip_verbatim(d).to_string_lossy().into_owned()).unwrap_or_default();
        self.with(|c| {
            Ok(c.query_row(
                "SELECT 1 FROM book_paths WHERE path=?1 OR (path=?2 AND book_id IN (SELECT id FROM books WHERE format='image')) LIMIT 1",
                params![p, parent],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
        })
        .unwrap_or(false)
    }

    // ---- collections ------------------------------------------------------------------------

    pub fn list_collections(&self) -> Res<Vec<Collection>> {
        self.with(|c| {
            let mut s = c.prepare(
                "SELECT c.id, c.name, (SELECT COUNT(*) FROM book_collections bc JOIN books b ON b.id=bc.book_id \
                 WHERE bc.collection_id=c.id AND b.removed=0) FROM collections c ORDER BY c.name COLLATE NOCASE",
            )?;
            let v = s.query_map([], |r| Ok(Collection { id: r.get(0)?, name: r.get(1)?, count: r.get(2)? }))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
    }
    pub fn create_collection(&self, name: &str) -> Res<Collection> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::invalid("A collection needs a name."));
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.tx(|t| {
            t.execute("INSERT INTO collections(id,name,created_at) VALUES(?1,?2,?3)", params![id, name, now_ms()])
                .map_err(|_| Error::invalid("You already have a collection with that name."))?;
            Ok(Collection { id: id.clone(), name: name.into(), count: 0 })
        })
    }
    pub fn rename_collection(&self, id: &str, name: &str) -> Res<()> {
        self.tx(|t| {
            let n = t.execute("UPDATE collections SET name=?2 WHERE id=?1", params![id, name.trim()])
                .map_err(|_| Error::invalid("You already have a collection with that name."))?;
            if n == 0 { Err(Error::not_found("that collection")) } else { Ok(()) }
        })
    }
    pub fn delete_collection(&self, id: &str) -> Res<()> {
        self.tx(|t| done(t.execute("DELETE FROM collections WHERE id=?1", [id])))
    }
    pub fn add_to_collection(&self, book_id: &str, collection_id: &str) -> Res<()> {
        self.tx(|t| {
            t.execute("INSERT OR IGNORE INTO book_collections VALUES(?1,?2)", params![book_id, collection_id])
                .map_err(|_| Error::not_found("that book or collection"))?;
            Ok(())
        })
    }
    pub fn remove_from_collection(&self, book_id: &str, collection_id: &str) -> Res<()> {
        self.tx(|t| done(t.execute("DELETE FROM book_collections WHERE book_id=?1 AND collection_id=?2", params![book_id, collection_id])))
    }

    // ---- progress and sessions --------------------------------------------------------------

    pub fn save_progress(&self, book_id: &str, locator: &Value, fraction: f64) -> Res<()> {
        let f = fraction.clamp(0.0, 1.0);
        self.tx(|t| {
            t.execute(
                "INSERT INTO progress(book_id,locator,fraction,updated_at) VALUES(?1,?2,?3,?4) \
                 ON CONFLICT(book_id) DO UPDATE SET locator=?2, fraction=?3, updated_at=?4",
                params![book_id, locator.to_string(), f, now_ms()],
            )
            .map_err(|_| Error::not_found("that book"))?;
            if f >= 0.995 {
                t.execute("UPDATE books SET status='finished' WHERE id=?1", [book_id])?;
            } else if f > 0.0 {
                t.execute("UPDATE books SET status='reading' WHERE id=?1 AND status<>'reading'", [book_id])?;
            }
            Ok(())
        })
    }

    pub fn get_progress(&self, book_id: &str) -> Res<Option<Progress>> {
        self.with(|c| get_progress_c(c, book_id))
    }

    pub fn start_session(&self, book_id: &str) -> Res<i32> {
        self.tx(|t| {
            t.execute("INSERT INTO reading_sessions(book_id,started_at) VALUES(?1,?2)", params![book_id, now_ms()])
                .map_err(|_| Error::not_found("that book"))?;
            Ok(t.last_insert_rowid() as i32)
        })
    }
    /// `unit` is "words" or "pages".
    pub fn end_session(&self, session_id: i32, amount: f64, unit: &str) -> Res<()> {
        self.end_session_at(session_id, amount, unit, now_ms())
    }
    pub fn end_session_at(&self, session_id: i32, amount: f64, unit: &str, at: f64) -> Res<()> {
        if unit != "words" && unit != "pages" {
            return Err(Error::invalid("Unit must be words or pages."));
        }
        self.tx(|t| {
            done(t.execute(
                "UPDATE reading_sessions SET ended_at=?2, amount=?3, unit=?4 WHERE id=?1",
                params![session_id, at, amount, unit],
            ))
        })
    }

    /// Median of recent sessions (this book if it has >= 3, else all books), with sane defaults.
    pub fn reading_speed(&self, book_id: Option<&str>) -> Res<ReadingSpeed> {
        self.with(|c| {
            let rate = |unit: &str, lo: f64, hi: f64| -> Res<Option<f64>> {
                let mut rates = vec![];
                for scope in [book_id, None] {
                    let mut s = c.prepare(
                        "SELECT amount / ((ended_at - started_at) / 60000.0) FROM reading_sessions \
                         WHERE unit=?1 AND ended_at IS NOT NULL AND amount>0 AND ended_at-started_at >= 20000 \
                         AND (?2 IS NULL OR book_id=?2) ORDER BY id DESC LIMIT 20",
                    )?;
                    rates = s.query_map(params![unit, scope], |r| r.get::<_, f64>(0))?
                        .filter_map(|r| r.ok())
                        .filter(|r| (lo..=hi).contains(r))
                        .collect();
                    if scope.is_none() || rates.len() >= 3 {
                        break;
                    }
                }
                rates.sort_by(|a, b| a.total_cmp(b));
                Ok((!rates.is_empty()).then(|| rates[rates.len() / 2]))
            };
            Ok(ReadingSpeed {
                words_per_minute: rate("words", 40.0, 2000.0)?.unwrap_or(250.0),
                minutes_per_page: rate("pages", 0.1, 30.0)?.map(|p| 1.0 / p).unwrap_or(1.2),
            })
        })
    }

    // ---- annotations ------------------------------------------------------------------------

    pub fn create_annotation(&self, n: &NewAnnotation) -> Res<Annotation> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        self.tx(|t| {
            t.execute(
                "INSERT INTO annotations(id,book_id,type,color,anchor,pos,note,label,created_at,updated_at) \
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
                params![id, n.book_id, n.kind.as_str(), n.color, n.anchor.0.to_string(), anchor_pos(&n.anchor.0), n.note, n.label, now],
            )
            .map_err(|_| Error::not_found("that book"))?;
            get_annotation_c(t, &id)
        })
    }

    pub fn update_annotation(&self, id: &str, p: &AnnotationPatch) -> Res<Annotation> {
        self.tx(|t| {
            let a = get_annotation_c(t, id)?;
            let anchor = p.anchor.clone().unwrap_or(a.anchor);
            t.execute(
                "UPDATE annotations SET type=?2,color=?3,anchor=?4,pos=?5,note=?6,label=?7,updated_at=?8 WHERE id=?1",
                params![
                    id,
                    p.kind.unwrap_or(a.kind).as_str(),
                    p.color.clone().or(a.color),
                    anchor.0.to_string(),
                    anchor_pos(&anchor.0),
                    p.note.clone().or(a.note),
                    p.label.clone().or(a.label),
                    now_ms()
                ],
            )?;
            get_annotation_c(t, id)
        })
    }

    /// Soft delete (undo-able via `restore_annotation`).
    pub fn delete_annotation(&self, id: &str) -> Res<()> {
        self.tx(|t| {
            let n = t.execute("UPDATE annotations SET deleted_at=?2 WHERE id=?1", params![id, now_ms()])?;
            if n == 0 { Err(Error::not_found("that annotation")) } else { Ok(()) }
        })
    }
    pub fn restore_annotation(&self, id: &str) -> Res<Annotation> {
        self.tx(|t| {
            t.execute("UPDATE annotations SET deleted_at=NULL WHERE id=?1", [id])?;
            get_annotation_c(t, id)
        })
    }
    /// Permanently drop annotations soft-deleted before `before` (ms). Called on startup.
    pub fn purge_deleted_annotations(&self, before: f64) -> Res<usize> {
        self.tx(|t| Ok(t.execute("DELETE FROM annotations WHERE deleted_at IS NOT NULL AND deleted_at<?1", [before])?))
    }

    pub fn list_annotations(&self, book_id: &str) -> Res<Vec<Annotation>> {
        self.with(|c| {
            let mut s = c.prepare(&format!(
                "SELECT {ANN_COLS} FROM annotations WHERE book_id=?1 AND deleted_at IS NULL ORDER BY pos, created_at"
            ))?;
            let v = s.query_map([book_id], row_to_annotation)?.collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
    }

    /// Library-wide view; `query` matches note, label and the highlighted quote.
    pub fn list_all_annotations(&self, query: Option<&str>) -> Res<Vec<AnnotationWithBook>> {
        self.with(|c| {
            let mut sql = format!(
                "SELECT {ANN_COLS_A}, b.title, b.author FROM annotations a JOIN books b ON b.id=a.book_id "
            ) + "WHERE a.deleted_at IS NULL AND b.removed=0";
            let mut args: Vec<Sql> = vec![];
            for w in query.unwrap_or("").split_whitespace() {
                sql += " AND (a.note LIKE ? ESCAPE '!' OR a.label LIKE ? ESCAPE '!' OR json_extract(a.anchor,'$.quote.exact') LIKE ? ESCAPE '!')";
                let pat = format!("%{}%", w.replace('!', "!!").replace('%', "!%").replace('_', "!_"));
                args.extend([Sql::Text(pat.clone()), Sql::Text(pat.clone()), Sql::Text(pat)]);
            }
            sql += " ORDER BY b.title COLLATE NOCASE, a.pos, a.created_at";
            let mut s = c.prepare(&sql)?;
            let v = s
                .query_map(params_from_iter(args), |r| {
                    Ok(AnnotationWithBook { annotation: row_to_annotation(r)?, book_title: r.get(10)?, book_author: r.get(11)? })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
    }

    // ---- settings ---------------------------------------------------------------------------

    pub fn get_setting(&self, key: &str) -> Res<Option<Value>> {
        self.with(|c| {
            let v: Option<String> = c.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).optional()?;
            Ok(v.map(|s| serde_json::from_str(&s)).transpose()?)
        })
    }
    pub fn set_setting(&self, key: &str, value: &Value) -> Res<()> {
        self.tx(|t| {
            if value.is_null() {
                t.execute("DELETE FROM settings WHERE key=?1", [key])?;
            } else {
                t.execute(
                    "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
                    params![key, value.to_string()],
                )?;
            }
            Ok(())
        })
    }
    pub fn get_all_settings(&self) -> Res<HashMap<String, Json>> {
        self.with(|c| {
            let mut s = c.prepare("SELECT key,value FROM settings")?;
            let rows = s.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            let mut m = HashMap::new();
            for r in rows {
                let (k, v) = r?;
                if let Ok(v) = serde_json::from_str(&v) {
                    m.insert(k, Json(v));
                }
            }
            Ok(m)
        })
    }

    // ---- watched folders --------------------------------------------------------------------

    pub fn list_watched_folders(&self) -> Res<Vec<String>> {
        self.with(|c| {
            let mut s = c.prepare("SELECT path FROM watched_folders ORDER BY id")?;
            let v = s.query_map([], |r| r.get(0))?.collect::<Result<Vec<String>, _>>()?;
            Ok(v)
        })
    }
    pub fn add_watched_folder(&self, path: &str) -> Res<()> {
        self.tx(|t| done(t.execute("INSERT OR IGNORE INTO watched_folders(path,added_at) VALUES(?1,?2)", params![path, now_ms()])))
    }
    pub fn remove_watched_folder(&self, path: &str) -> Res<()> {
        self.tx(|t| done(t.execute("DELETE FROM watched_folders WHERE path=?1", [path])))
    }
}

// ---- row helpers --------------------------------------------------------------------------

const BOOK_COLS: &str = "b.id,b.fingerprint,b.format,b.title,b.author,b.cover_path,b.cover_rev,b.needs_cover,\
b.page_count,b.word_count,b.status,b.added_at,b.last_opened_at,b.file_size,b.settings,\
(SELECT path FROM book_paths p WHERE p.book_id=b.id ORDER BY available DESC, last_seen_at DESC LIMIT 1),\
EXISTS(SELECT 1 FROM book_paths p WHERE p.book_id=b.id AND p.available=1),pr.fraction";
const BOOK_FROM: &str = "FROM books b LEFT JOIN progress pr ON pr.book_id=b.id";
const ANN_COLS_A: &str = "a.id,a.book_id,a.type,a.color,a.anchor,a.note,a.label,a.created_at,a.updated_at,a.deleted_at";
const ANN_COLS: &str = "id,book_id,type,color,anchor,note,label,created_at,updated_at,deleted_at";

pub fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => p.to_path_buf(),
    }
}

fn row_to_book(r: &Row) -> rusqlite::Result<Book> {
    let id: String = r.get(0)?;
    let cover: Option<String> = r.get(5)?;
    let rev: i64 = r.get(6)?;
    let settings: String = r.get(14)?;
    let fmt: String = r.get(2)?;
    Ok(Book {
        cover_url: cover.map(|_| format!("{QUIRE_ORIGIN}/cover/{id}?v={rev}")),
        id,
        fingerprint: r.get(1)?,
        format: Format::parse(&fmt).unwrap_or(Format::Pdf),
        title: r.get(3)?,
        author: r.get(4)?,
        needs_cover: r.get(7)?,
        page_count: r.get(8)?,
        word_count: r.get(9)?,
        status: Status::parse(&r.get::<_, String>(10)?),
        added_at: r.get(11)?,
        last_opened_at: r.get(12)?,
        file_size: r.get(13)?,
        settings: Json(serde_json::from_str(&settings).unwrap_or(Value::Object(Default::default()))),
        path: r.get(15)?,
        available: r.get(16)?,
        progress: r.get(17)?,
        collections: vec![],
    })
}

pub fn get_book_c(c: &Connection, id: &str) -> Res<Book> {
    let sql = format!("SELECT {BOOK_COLS} {BOOK_FROM} WHERE b.id=?1");
    let b = c.query_row(&sql, [id], row_to_book).map_err(|_| Error::not_found("that book"))?;
    let mut one = [b];
    fill_collections(c, &mut one)?;
    let [b] = one;
    Ok(b)
}

fn fill_collections(c: &Connection, books: &mut [Book]) -> Res<()> {
    if books.is_empty() {
        return Ok(());
    }
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    let mut s = c.prepare("SELECT book_id, collection_id FROM book_collections")?;
    for r in s.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (b, col) = r?;
        map.entry(b).or_default().push(col);
    }
    for b in books {
        b.collections = map.remove(&b.id).unwrap_or_default();
    }
    Ok(())
}

pub fn get_progress_c(c: &Connection, book_id: &str) -> Res<Option<Progress>> {
    Ok(c.query_row("SELECT locator,fraction,updated_at FROM progress WHERE book_id=?1", [book_id], |r| {
        let loc: String = r.get(0)?;
        Ok(Progress {
            book_id: book_id.to_string(),
            locator: Json(serde_json::from_str(&loc).unwrap_or(Value::Null)),
            fraction: r.get(1)?,
            updated_at: r.get(2)?,
        })
    })
    .optional()?)
}

fn row_to_annotation(r: &Row) -> rusqlite::Result<Annotation> {
    let anchor: String = r.get(4)?;
    Ok(Annotation {
        id: r.get(0)?,
        book_id: r.get(1)?,
        kind: AnnotationKind::parse(&r.get::<_, String>(2)?),
        color: r.get(3)?,
        anchor: Json(serde_json::from_str(&anchor).unwrap_or(Value::Null)),
        note: r.get(5)?,
        label: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
        deleted_at: r.get(9)?,
    })
}

fn get_annotation_c(c: &Connection, id: &str) -> Res<Annotation> {
    c.query_row(&format!("SELECT {ANN_COLS} FROM annotations WHERE id=?1"), [id], row_to_annotation)
        .map_err(|_| Error::not_found("that annotation"))
}

/// Sortable position: fixed layouts `page*1e6 + y`, reflow `fraction*1e6`.
pub fn anchor_pos(anchor: &Value) -> f64 {
    let l = &anchor["locator"];
    match l["kind"].as_str() {
        Some("fixed") => l["page"].as_f64().unwrap_or(0.0) * 1e6 + l["y"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0) * 999_999.0,
        Some("reflow") => l["fraction"].as_f64().unwrap_or(0.0) * 1e6,
        _ => 0.0,
    }
}

fn done(r: rusqlite::Result<usize>) -> Res<()> {
    r.map(|_| ()).map_err(Into::into)
}
