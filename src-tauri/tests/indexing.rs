//! Indexing and OCR against a temp database (no Tauri runtime).
use std::fs;
use std::path::Path;

use quire_lib::backend::index::{fts_query, Chunk, IndexState, INDEX_VERSION};
use quire_lib::backend::model::*;
use quire_lib::backend::Db;
use serde_json::json;
use tempfile::TempDir;

fn new_db() -> (TempDir, Db) {
    let t = tempfile::tempdir().unwrap();
    let db = Db::open(&t.path().join("data")).unwrap();
    (t, db)
}

fn book(db: &Db, dir: &Path, name: &str) -> Book {
    let p = dir.join(name);
    fs::write(&p, format!("%PDF-1.4\n{name}\n%%EOF")).unwrap();
    db.register(&p, true).unwrap().unwrap().book
}

fn chunk(page: u32, text: &str) -> Chunk {
    Chunk { locator: Json(json!({"kind":"fixed","page":page})), text: text.into() }
}

fn count_rows(db: &Db) -> i64 {
    db.with(|c| Ok(c.query_row("SELECT COUNT(*) FROM text_index", [], |r| r.get(0)).unwrap())).unwrap()
}

#[test]
fn first_batch_replaces_old_chunks_and_later_batches_append() {
    let (t, db) = new_db();
    let b = book(&db, t.path(), "a.pdf");
    db.index_batch(&b.id, &[chunk(0, "alpha one"), chunk(1, "alpha two")], true, false).unwrap();
    db.index_batch(&b.id, &[chunk(2, "alpha three")], false, true).unwrap();
    assert_eq!(count_rows(&db), 3);
    assert_eq!(db.search_library_text("alpha", 10).unwrap().len(), 3);

    // A new run drops the old chunks (by rowid range, not a scan) and only the new ones remain.
    db.index_batch(&b.id, &[chunk(0, "beta only")], true, true).unwrap();
    assert_eq!(count_rows(&db), 1);
    assert!(db.search_library_text("alpha", 10).unwrap().is_empty());
    assert_eq!(db.search_library_text("beta", 10).unwrap().len(), 1);

    // Appending without a run in progress is refused, and a failed batch changes nothing.
    assert!(db.index_batch(&b.id, &[chunk(1, "gamma")], false, false).is_err());
    assert_eq!(count_rows(&db), 1);
    // Blank chunks are skipped.
    db.index_batch(&b.id, &[chunk(0, "  "), chunk(1, "delta")], true, true).unwrap();
    assert_eq!(count_rows(&db), 1);
}

#[test]
fn another_books_chunks_survive_a_reindex() {
    let (t, db) = new_db();
    let (a, b) = (book(&db, t.path(), "a.pdf"), book(&db, t.path(), "b.pdf"));
    db.index_chunks(&a.id, &[(json!({"page":0}), "shared words here".into())]).unwrap();
    db.index_chunks(&b.id, &[(json!({"page":0}), "shared words there".into())]).unwrap();
    db.index_chunks(&a.id, &[(json!({"page":1}), "replaced text".into())]).unwrap();
    let hits = db.search_library_text("shared", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].book_id, b.id);
}

#[test]
fn nasty_queries_never_error() {
    let (t, db) = new_db();
    let b = book(&db, t.path(), "a.pdf");
    db.index_chunks(&b.id, &[(json!({"page":0}), "Don't panic: the AND NOT NEAR text-index (really) costs 5*3 dollars".into())]).unwrap();
    let long = "x".repeat(5000);
    let many = "word ".repeat(500);
    for q in [
        "\"", "\"\"", "-", "- -", "AND(", "OR", "NOT", "NEAR(", "NEAR/2", "*", "**", "a*", "(", ")", "((", "\"unterminated phrase", "foo\"bar", "col:val", "chunk:x",
        "^start", "a OR b", "a AND", "; DROP TABLE books; --", "'", "\\", "%", "_", "\u{0}", "日本語", "😀", "   ", "", &long, &many,
    ] {
        assert!(db.search_library_text(q, 10).is_ok(), "query {q:?} must not error");
    }
    assert!(fts_query("   ").is_none() && fts_query("\"\"").is_none() && fts_query("-").is_none());
    // Operators typed by the user are plain words.
    assert_eq!(db.search_library_text("AND NOT", 10).unwrap().len(), 1);
    assert_eq!(db.search_library_text("text-index", 10).unwrap().len(), 1, "hyphenated word = phrase");
    assert_eq!(db.search_library_text("don't", 10).unwrap().len(), 1);
}

#[test]
fn phrase_and_prefix_queries() {
    let (t, db) = new_db();
    let b = book(&db, t.path(), "a.pdf");
    db.index_chunks(
        &b.id,
        &[
            (json!({"page":0}), "the quick brown fox".into()),
            (json!({"page":1}), "brown quick fox lazy".into()),
            (json!({"page":2}), "extraordinary measures".into()),
        ],
    )
    .unwrap();
    assert_eq!(db.search_library_text("\"quick brown\"", 10).unwrap().len(), 1, "phrase keeps word order");
    assert_eq!(db.search_library_text("quick brown", 10).unwrap().len(), 2, "bare words are ANDed");
    assert_eq!(db.search_library_text("extra", 10).unwrap().len(), 1, "last word is a prefix while typing");
    assert_eq!(db.search_library_text("\"quick bro", 10).unwrap()[0].locator.0["page"], 0, "open phrase works as a typed prefix");
    assert!(db.search_library_text("extra ", 10).unwrap().is_empty(), "a finished word is exact");
    let snip = &db.search_library_text("\"quick brown\"", 10).unwrap()[0].snippet;
    assert!(snip.contains("<mark>quick</mark> <mark>brown</mark>") || snip.contains("<mark>quick brown</mark>"), "{snip}");
}

#[test]
fn ranking_prefers_dense_matches_and_caps_hits_per_book() {
    let (t, db) = new_db();
    let (a, b) = (book(&db, t.path(), "a.pdf"), book(&db, t.path(), "b.pdf"));
    let filler = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ";
    // Book a: 12 weak mentions. Book b: one passage that is all about the term.
    let weak: Vec<_> = (0..12).map(|i| (json!({"page":i}), format!("{filler}{filler}{filler} whale {filler}{filler}"))).collect();
    db.index_chunks(&a.id, &weak).unwrap();
    db.index_chunks(&b.id, &[(json!({"page":0}), "whale whale whale whale".into())]).unwrap();
    let hits = db.search_library_text("whale", 50).unwrap();
    assert_eq!(hits[0].book_id, b.id, "dense passage ranks first");
    assert_eq!(hits.iter().filter(|h| h.book_id == a.id).count(), 5, "one book can't flood the list");
    assert_eq!(db.search_library_text("whale", 3).unwrap().len(), 3, "limit honoured");
    assert!(hits[0].snippet.contains("<mark>whale</mark>"));
    db.remove_book(&b.id).unwrap();
    assert!(db.search_library_text("whale", 50).unwrap().iter().all(|h| h.book_id == a.id));
}

#[test]
fn index_version_triggers_reindex_and_failures_back_off() {
    let (t, db) = new_db();
    let b = book(&db, t.path(), "a.pdf");
    assert_eq!(db.books_needing_index(10).unwrap().len(), 1, "new books need indexing");
    db.index_chunks(&b.id, &[(json!({"page":0}), "hello".into())]).unwrap();
    assert!(db.books_needing_index(10).unwrap().is_empty());
    let st = db.index_status(false).unwrap();
    assert_eq!((st.done, st.total, st.failed), (1, 1, 0));
    assert_eq!(st.books[0].state, IndexState::Done);

    // An older extractor version makes it pending again (its chunks stay searchable until replaced).
    db.with(|c| Ok(c.execute("UPDATE index_state SET version=?1", [INDEX_VERSION - 1]).unwrap())).unwrap();
    assert_eq!(db.books_needing_index(10).unwrap().len(), 1);
    assert_eq!(db.index_status(false).unwrap().done, 0);
    assert_eq!(db.search_library_text("hello", 5).unwrap().len(), 1);

    // An interrupted run is picked up again; a failed book is left alone for a day, then retried.
    db.index_batch(&b.id, &[chunk(0, "half")], true, false).unwrap();
    assert_eq!(db.books_needing_index(10).unwrap().len(), 1);
    db.mark_index_failed(&b.id, "corrupt").unwrap();
    assert!(db.books_needing_index(10).unwrap().is_empty());
    assert_eq!(db.index_status(false).unwrap().books[0].error.as_deref(), Some("corrupt"));
    assert_eq!(count_rows(&db), 0, "partial chunks are dropped on failure");
    db.with(|c| Ok(c.execute("UPDATE index_state SET updated_at=updated_at-90000000", []).unwrap())).unwrap();
    assert_eq!(db.books_needing_index(10).unwrap().len(), 1);

    db.index_chunks(&b.id, &[(json!({"page":0}), "again".into())]).unwrap();
    db.clear_index(&b.id).unwrap();
    assert_eq!(db.books_needing_index(10).unwrap().len(), 1);
    assert_eq!(count_rows(&db), 0);
}

#[test]
fn comics_are_indexed_only_after_ocr() {
    let (t, db) = new_db();
    let p = t.path().join("c.cbz");
    let mut png = std::io::Cursor::new(vec![]);
    image::RgbImage::from_pixel(8, 8, image::Rgb([9, 9, 9])).write_to(&mut png, image::ImageFormat::Png).unwrap();
    let mut z = zip::ZipWriter::new(fs::File::create(&p).unwrap());
    z.start_file("1.png", zip::write::SimpleFileOptions::default()).unwrap();
    std::io::Write::write_all(&mut z, png.get_ref()).unwrap();
    z.finish().unwrap();
    let b = db.register(&p, true).unwrap().unwrap().book;
    assert_eq!(b.format, Format::Cbz);
    assert!(db.books_needing_index(10).unwrap().is_empty(), "no text, nothing to index");
    let page = quire_lib::backend::ocr::OcrPage { page: 0, lang: "en-US".into(), words: vec![] };
    db.ocr_store(&b.id, &page).unwrap();
    assert_eq!(db.books_needing_index(10).unwrap().len(), 1);
    assert_eq!(db.ocr_status(&b.id).unwrap().pages_done, 1);
}

#[test]
fn ocr_cache_round_trips() {
    use quire_lib::backend::ocr::{OcrPage, OcrWordN};
    let (t, db) = new_db();
    let b = book(&db, t.path(), "scan.pdf");
    let w = |t: &str| OcrWordN { text: t.into(), x: 0.1, y: 0.2, width: 0.3, height: 0.04 };
    db.ocr_store(&b.id, &OcrPage { page: 2, lang: "en-US".into(), words: vec![w("two")] }).unwrap();
    db.ocr_store(&b.id, &OcrPage { page: 0, lang: "en-US".into(), words: vec![w("zero")] }).unwrap();
    db.ocr_store(&b.id, &OcrPage { page: 0, lang: "en-US".into(), words: vec![w("again")] }).unwrap();
    let pages = db.ocr_pages(&b.id).unwrap();
    assert_eq!(pages.iter().map(|p| p.page).collect::<Vec<_>>(), [0, 2]);
    assert_eq!(pages[0].words[0], w("again"));
    assert_eq!(db.ocr_status(&b.id).unwrap().lang.as_deref(), Some("en-US"));
    db.clear_ocr(&b.id).unwrap();
    assert!(db.ocr_pages(&b.id).unwrap().is_empty());
}

/// Windows only: the real recogniser on a generated scan ("QUIRE READS SCANS" + a sentence).
#[cfg(windows)]
#[test]
fn windows_ocr_reads_a_fixture_scan() {
    use quire_lib::backend::ocr;
    let langs = ocr::languages().unwrap();
    if langs.is_empty() {
        eprintln!("SKIPPED windows_ocr_reads_a_fixture_scan: no OCR language is installed in Windows");
        return;
    }
    eprintln!("OCR languages: {:?}", langs.iter().map(|l| format!("{}{}", l.tag, if l.default { "*" } else { "" })).collect::<Vec<_>>());
    let png = fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/scan.png")).unwrap();
    ocr::recognize(&png, 0, 0, None).unwrap(); // warm-up: loads the language pack
    let t0 = std::time::Instant::now();
    let (words, tag) = ocr::recognize(&png, 0, 0, None).unwrap();
    eprintln!("OCR {} words in {:?} using {tag}", words.len(), t0.elapsed());
    let text = words.iter().map(|w| w.text.to_lowercase()).collect::<Vec<_>>().join(" ");
    for want in ["quire", "reads", "scans"] {
        assert!(text.contains(want), "expected {want:?} in {text:?}");
    }
    let quire = words.iter().find(|w| w.text.eq_ignore_ascii_case("quire")).unwrap();
    assert!(quire.x > 0.0 && quire.x < 0.2 && quire.y > 0.05 && quire.y < 0.2, "boxes are normalised to the page: {quire:?}");
    assert!(words.iter().all(|w| w.x + w.width <= 1.0 && w.y + w.height <= 1.0));
}
