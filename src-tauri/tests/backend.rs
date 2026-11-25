//! Seam 2: the backend contract against a temp DB and a temp folder tree (no Tauri runtime).
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use quire_lib::backend::model::*;
use quire_lib::backend::{Core, CoreEvent, Db};
use serde_json::json;
use tempfile::TempDir;

fn pdf(dir: &Path, name: &str, seed: &str) -> PathBuf {
    let p = dir.join(name);
    fs::write(&p, format!("%PDF-1.4\n{seed}\n%%EOF").as_bytes()).unwrap();
    p
}

fn png(w: u32, h: u32, shade: u8) -> Vec<u8> {
    let img = image::RgbImage::from_pixel(w, h, image::Rgb([shade, 80, 120]));
    let mut out = std::io::Cursor::new(vec![]);
    img.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

fn zip_of(path: &Path, files: &[(&str, Vec<u8>)]) {
    let mut z = zip::ZipWriter::new(fs::File::create(path).unwrap());
    let o = zip::write::SimpleFileOptions::default();
    for (n, b) in files {
        z.start_file(*n, o).unwrap();
        z.write_all(b).unwrap();
    }
    z.finish().unwrap();
}

fn new_db() -> (TempDir, Db) {
    let t = tempfile::tempdir().unwrap();
    let db = Db::open(&t.path().join("data")).unwrap();
    (t, db)
}

fn open(db: &Db, p: &Path) -> Book {
    db.register(p, true).unwrap().unwrap().book
}

#[test]
fn migrations_are_idempotent() {
    let t = tempfile::tempdir().unwrap();
    let dir = t.path().join("d");
    drop(Db::open(&dir).unwrap());
    let db = Db::open(&dir).unwrap();
    let v: i32 = db.with(|c| Ok(c.query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))?)).unwrap();
    assert_eq!(v, quire_lib::backend::db::SCHEMA_VERSION);
    let n: i32 = db.with(|c| Ok(c.query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))?)).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn relinks_after_move_and_rename_keeping_progress() {
    let (t, db) = new_db();
    let lib = t.path().join("lib");
    fs::create_dir_all(lib.join("sub")).unwrap();
    let a = pdf(&lib, "a.pdf", "same content");
    let b1 = open(&db, &a);
    db.save_progress(&b1.id, &json!({"kind":"fixed","page":4}), 0.4).unwrap();
    let ann = db
        .create_annotation(&NewAnnotation { book_id: b1.id.clone(), kind: AnnotationKind::Highlight, color: Some("yellow".into()), anchor: Json(json!({"locator":{"kind":"fixed","page":4}})), note: None, label: None })
        .unwrap();

    let moved = lib.join("sub").join("renamed.pdf");
    fs::rename(&a, &moved).unwrap();
    let r = db.register(&moved, false).unwrap().unwrap();
    assert!(!r.created);
    assert_eq!(r.book.id, b1.id);
    assert!(r.book.path.unwrap().ends_with("renamed.pdf"));
    assert_eq!(db.list_books(&ListQuery::default()).unwrap().len(), 1);
    assert_eq!(db.get_progress(&b1.id).unwrap().unwrap().fraction, 0.4);
    assert_eq!(db.list_annotations(&b1.id).unwrap()[0].id, ann.id);
    let old: bool = db.with(|c| Ok(c.query_row("SELECT available FROM book_paths WHERE path LIKE '%a.pdf'", [], |r| r.get(0))?)).unwrap();
    assert!(!old, "old path must be unavailable");
}

#[test]
fn same_file_at_two_paths_is_one_book() {
    let (t, db) = new_db();
    let a = pdf(t.path(), "one.pdf", "twin");
    let b = t.path().join("two.pdf");
    fs::copy(&a, &b).unwrap();
    let x = open(&db, &a);
    let y = open(&db, &b);
    assert_eq!(x.id, y.id);
    let n: i32 = db.with(|c| Ok(c.query_row("SELECT COUNT(*) FROM book_paths", [], |r| r.get(0))?)).unwrap();
    assert_eq!(n, 2);
    // Removing one copy leaves the book available through the other.
    fs::remove_file(&a).unwrap();
    db.refresh_availability().unwrap();
    assert!(db.get_book(&x.id).unwrap().available);
    assert!(db.resolve_book_path(&x.id).unwrap().ends_with("two.pdf"));
}

#[test]
fn missing_files_are_unavailable_then_available_again() {
    let (t, db) = new_db();
    let a = pdf(t.path(), "m.pdf", "missing");
    let b = open(&db, &a);
    let hidden = t.path().join("hidden.pdf");
    fs::rename(&a, &hidden).unwrap();
    assert_eq!(db.refresh_availability().unwrap(), vec![b.id.clone()]);
    let got = db.get_book(&b.id).unwrap();
    assert!(!got.available);
    assert!(db.list_books(&ListQuery::default()).unwrap().iter().any(|x| x.id == b.id), "stays listed");
    fs::rename(&hidden, &a).unwrap();
    db.refresh_availability().unwrap();
    assert!(db.get_book(&b.id).unwrap().available);
}

#[test]
fn progress_and_annotations_persist_across_reopen() {
    let t = tempfile::tempdir().unwrap();
    let dir = t.path().join("data");
    let f = pdf(t.path(), "p.pdf", "persist");
    let id;
    {
        let db = Db::open(&dir).unwrap();
        id = open(&db, &f).id;
        db.save_progress(&id, &json!({"kind":"reflow","cfi":"epubcfi(/6/2)","fraction":0.5}), 0.5).unwrap();
        db.create_annotation(&NewAnnotation { book_id: id.clone(), kind: AnnotationKind::Note, color: None, anchor: Json(json!({"locator":{"kind":"fixed","page":1}})), note: Some("hello".into()), label: None }).unwrap();
        db.set_setting("keymap", &json!({"a": "b"})).unwrap();
        db.set_book_settings(&id, &json!({"zoom": 1.5, "fit": "width"})).unwrap();
    }
    let db = Db::open(&dir).unwrap();
    let p = db.get_progress(&id).unwrap().unwrap();
    assert_eq!(p.fraction, 0.5);
    assert_eq!(p.locator.0["cfi"], "epubcfi(/6/2)");
    assert_eq!(db.get_book(&id).unwrap().status, Status::Reading);
    assert_eq!(db.list_annotations(&id).unwrap()[0].note.as_deref(), Some("hello"));
    assert_eq!(db.get_setting("keymap").unwrap().unwrap()["a"], "b");
    assert_eq!(db.get_book(&id).unwrap().settings.0["zoom"], 1.5);
    // merge + null deletes
    let merged = db.set_book_settings(&id, &json!({"fit": null, "rotation": 90})).unwrap();
    assert_eq!(merged, json!({"zoom": 1.5, "rotation": 90}));
    db.save_progress(&id, &json!({}), 1.0).unwrap();
    assert_eq!(db.get_book(&id).unwrap().status, Status::Finished);
}

#[test]
fn annotations_soft_delete_restore_and_order() {
    let (t, db) = new_db();
    let b = open(&db, &pdf(t.path(), "n.pdf", "ann"));
    let mk = |page: i32, y: f64, q: &str| NewAnnotation {
        book_id: b.id.clone(),
        kind: AnnotationKind::Highlight,
        color: Some("yellow".into()),
        anchor: Json(json!({"locator":{"kind":"fixed","page":page,"y":y},"quote":{"exact":q,"prefix":"","suffix":""}})),
        note: Some(format!("note {q}")),
        label: None,
    };
    let late = db.create_annotation(&mk(9, 0.1, "zebra")).unwrap();
    let early = db.create_annotation(&mk(2, 0.9, "apple")).unwrap();
    let mid = db.create_annotation(&mk(2, 0.95, "mango")).unwrap();
    let order: Vec<_> = db.list_annotations(&b.id).unwrap().into_iter().map(|a| a.id).collect();
    assert_eq!(order, vec![early.id.clone(), mid.id.clone(), late.id.clone()]);

    db.delete_annotation(&mid.id).unwrap();
    assert_eq!(db.list_annotations(&b.id).unwrap().len(), 2);
    assert_eq!(db.list_all_annotations(Some("mango")).unwrap().len(), 0);
    let back = db.restore_annotation(&mid.id).unwrap();
    assert!(back.deleted_at.is_none());
    assert_eq!(db.list_annotations(&b.id).unwrap().len(), 3);

    let hits = db.list_all_annotations(Some("zebra")).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].book_title, "n");
    let upd = db.update_annotation(&early.id, &AnnotationPatch { note: Some("changed".into()), ..Default::default() }).unwrap();
    assert_eq!(upd.note.as_deref(), Some("changed"));
    assert_eq!(upd.color.as_deref(), Some("yellow"));
}

#[test]
fn full_text_search_returns_snippets() {
    let (t, db) = new_db();
    let b = open(&db, &pdf(t.path(), "s.pdf", "fts"));
    db.index_chunks(&b.id, &[
        (json!({"kind":"fixed","page":0}), "The Quick brown fox jumped over the lazy dog".into()),
        (json!({"kind":"fixed","page":1}), "Café society and naïve résumé".into()),
    ]).unwrap();
    let h = db.search_library_text("quick fox", 10).unwrap();
    assert_eq!(h.len(), 1);
    assert!(h[0].snippet.contains("<mark>Quick</mark>"));
    assert_eq!(h[0].locator.0["page"], 0);
    assert_eq!(db.search_library_text("cafe", 10).unwrap().len(), 1, "diacritics folded");
    assert_eq!(db.search_library_text("jump", 10).unwrap().len(), 1, "prefix on last term");
    assert!(db.search_library_text("\"; DROP", 10).is_ok());
    db.remove_book(&b.id).unwrap();
    assert!(db.search_library_text("quick", 10).unwrap().is_empty());
}

#[test]
fn list_books_sorts_and_filters() {
    let (t, db) = new_db();
    let mut ids = vec![];
    for (name, seed) in [("Beta", "1"), ("alpha", "2"), ("Gamma", "3")] {
        let p = pdf(t.path(), &format!("{name}.pdf"), seed);
        ids.push(open(&db, &p).id);
        std::thread::sleep(Duration::from_millis(5));
    }
    db.set_book_metadata(&ids[0], &MetadataPatch { author: Some("Zed".into()), user: true, ..Default::default() }).unwrap();
    db.set_book_metadata(&ids[1], &MetadataPatch { author: Some("Amy".into()), user: true, ..Default::default() }).unwrap();
    db.save_progress(&ids[2], &json!({}), 0.9).unwrap();
    db.save_progress(&ids[1], &json!({}), 0.2).unwrap();
    let titles = |q: ListQuery| db.list_books(&q).unwrap().into_iter().map(|b| b.title).collect::<Vec<_>>();
    let q = |sort| ListQuery { sort, ..Default::default() };
    assert_eq!(titles(q(SortKey::Title)), ["alpha", "Beta", "Gamma"]);
    assert_eq!(titles(ListQuery { sort: SortKey::Title, reverse: true, ..Default::default() }), ["Gamma", "Beta", "alpha"]);
    assert_eq!(titles(q(SortKey::Added)), ["Gamma", "alpha", "Beta"]);
    assert_eq!(titles(q(SortKey::Author)), ["alpha", "Beta", "Gamma"]);
    assert_eq!(titles(q(SortKey::Progress)), ["Gamma", "alpha", "Beta"]);
    assert_eq!(titles(q(SortKey::Recent))[0], "Gamma"); // most recently opened first (all opened on add; last one wins)
    assert_eq!(titles(ListQuery { status: Some(Status::Reading), ..Default::default() }), ["Gamma", "alpha"]);
    assert_eq!(titles(ListQuery { text: Some("zed".into()), ..Default::default() }), ["Beta"]);
    assert_eq!(titles(ListQuery { text: Some("a%".into()), ..Default::default() }), Vec::<String>::new());
    assert_eq!(titles(ListQuery { formats: vec![Format::Epub], ..Default::default() }).len(), 0);
    let col = db.create_collection("Favs").unwrap();
    db.add_to_collection(&ids[0], &col.id).unwrap();
    assert_eq!(titles(ListQuery { collection: Some(col.id.clone()), ..Default::default() }), ["Beta"]);
    assert_eq!(db.list_collections().unwrap()[0].count, 1);
    assert!(db.create_collection("favs").is_err(), "names are unique, case-insensitively");
    assert_eq!(db.continue_reading(5).unwrap().len(), 2);
    // remove hides it but keeps the file and data
    db.remove_book(&ids[0]).unwrap();
    assert_eq!(titles(ListQuery::default()).len(), 2);
    assert!(t.path().join("Beta.pdf").exists());
    assert!(db.register(&t.path().join("Beta.pdf"), false).unwrap().is_none(), "ingestion won't resurrect");
    assert_eq!(open(&db, &t.path().join("Beta.pdf")).id, ids[0], "opening does");
    assert_eq!(titles(ListQuery::default()).len(), 3);
}

#[test]
fn metadata_user_edits_win_over_extraction() {
    let (t, db) = new_db();
    let b = open(&db, &pdf(t.path(), "x.pdf", "meta"));
    db.set_book_metadata(&b.id, &MetadataPatch { title: Some("Mine".into()), user: true, ..Default::default() }).unwrap();
    let b = db.set_book_metadata(&b.id, &MetadataPatch { title: Some("From file".into()), author: Some("X".into()), page_count: Some(12), ..Default::default() }).unwrap();
    assert_eq!(b.title, "Mine");
    assert_eq!(b.page_count, Some(12));
}

#[test]
fn covers_save_and_serve_path() {
    let (t, db) = new_db();
    let b = open(&db, &pdf(t.path(), "c.pdf", "cover"));
    assert!(b.needs_cover && b.cover_url.is_none());
    assert_eq!(db.books_needing_covers().unwrap().len(), 1);
    db.save_cover(&b.id, b"RIFF....WEBPdata", "webp").unwrap();
    let b2 = db.get_book(&b.id).unwrap();
    assert!(!b2.needs_cover);
    assert!(b2.cover_url.unwrap().contains(&format!("/cover/{}?v=1", b.id)));
    assert!(db.cover_file(&b.id).unwrap().exists());
    assert!(db.books_needing_covers().unwrap().is_empty());
}

#[test]
fn extracts_epub_fb2_cbz_and_image_folders() {
    let (t, db) = new_db();
    // EPUB with OPF title/creator (with an entity) and a cover-image item
    let epub = t.path().join("b.epub");
    zip_of(&epub, &[
        ("mimetype", b"application/epub+zip".to_vec()),
        ("META-INF/container.xml", br#"<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#.to_vec()),
        ("OEBPS/content.opf", br#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Pride &amp; Prejudice</dc:title><dc:creator>Jane Austen</dc:creator></metadata><manifest><item id="c" href="img/cover%201.png" media-type="image/png" properties="cover-image"/></manifest></package>"#.to_vec()),
        ("OEBPS/img/cover 1.png", png(300, 600, 200)),
    ]);
    let e = open(&db, &epub);
    assert_eq!(e.format, Format::Epub);
    assert_eq!((e.title.as_str(), e.author.as_str()), ("Pride & Prejudice", "Jane Austen"));
    assert!(e.cover_url.is_some() && !e.needs_cover);
    let thumb = image::open(db.cover_file(&e.id).unwrap()).unwrap();
    assert_eq!(thumb.height(), 400);

    // FB2
    let fb2 = t.path().join("b.fb2");
    let b64 = {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.encode(png(100, 150, 50))
    };
    fs::write(&fb2, format!(r##"<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><author><first-name>Leo</first-name><last-name>Tolstoy</last-name></author><book-title>War and Peace</book-title><coverpage><image l:href="#cov"/></coverpage></title-info></description><body><section><p>Hi</p></section></body><binary id="cov" content-type="image/png">{b64}</binary></FictionBook>"##)).unwrap();
    let f = open(&db, &fb2);
    assert_eq!(f.format, Format::Fb2);
    assert_eq!((f.title.as_str(), f.author.as_str()), ("War and Peace", "Leo Tolstoy"));
    assert!(f.cover_url.is_some());

    // CBZ: natural order picks page2 over page10
    let cbz = t.path().join("comic.cbz");
    zip_of(&cbz, &[("page10.png", png(10, 10, 1)), ("page2.png", png(20, 30, 2)), ("page1.png", png(40, 60, 3))]);
    let c = open(&db, &cbz);
    assert_eq!((c.format, c.title.as_str()), (Format::Cbz, "comic"));
    assert_eq!(image::open(db.cover_file(&c.id).unwrap()).unwrap().width(), 40, "first page by natural order");

    // Folder of images / single image -> the folder is the book
    let dir = t.path().join("scans");
    fs::create_dir_all(&dir).unwrap();
    for (n, w) in [("img10.png", 10), ("img2.png", 20), ("img1.png", 30)] {
        fs::write(dir.join(n), png(w, w, w as u8)).unwrap();
    }
    let by_folder = db.register(&dir, true).unwrap().unwrap();
    assert_eq!(by_folder.book.format, Format::Image);
    assert!(by_folder.start_image.is_none());
    let by_image = db.register(&dir.join("img2.png"), true).unwrap().unwrap();
    assert_eq!(by_image.book.id, by_folder.book.id);
    assert!(by_image.start_image.unwrap().ends_with("img2.png"));
    let names: Vec<_> = quire_lib::backend::files::list_image_folder(&dir).unwrap().iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
    assert_eq!(names, ["img1.png", "img2.png", "img10.png"]);
    assert!(db.path_known(&dir.join("img10.png")));
    assert!(!db.path_known(&t.path().join("nope.png")));
    // Unsupported files are rejected with a calm error
    let junk = t.path().join("junk.bin");
    fs::write(&junk, b"hello world").unwrap();
    assert!(matches!(db.register(&junk, true), Err(e) if e.code == quire_lib::backend::error::ErrorCode::Unsupported));
}

#[test]
fn fingerprint_uses_size_head_and_tail() {
    let t = tempfile::tempdir().unwrap();
    let mib = 1024 * 1024;
    let mut data = vec![7u8; 3 * mib];
    let a = t.path().join("a.bin");
    fs::write(&a, &data).unwrap();
    let fa = quire_lib::backend::files::fingerprint(&a).unwrap();
    data[mib + 5] ^= 1; // middle byte: ignored
    let b = t.path().join("b.bin");
    fs::write(&b, &data).unwrap();
    assert_eq!(fa, quire_lib::backend::files::fingerprint(&b).unwrap());
    data[10] ^= 1; // head byte: matters
    fs::write(&b, &data).unwrap();
    assert_ne!(fa, quire_lib::backend::files::fingerprint(&b).unwrap());
}

#[test]
fn reading_speed_uses_median_with_defaults() {
    let (t, db) = new_db();
    let b = open(&db, &pdf(t.path(), "r.pdf", "speed"));
    let s = db.reading_speed(Some(&b.id)).unwrap();
    assert_eq!((s.words_per_minute, s.minutes_per_page), (250.0, 1.2));
    for wpm in [200.0, 300.0, 5000.0 /* absurd: ignored */, 400.0] {
        let id = db.start_session(&b.id).unwrap();
        // fake a 2-minute session
        db.with(|c| Ok(c.execute("UPDATE reading_sessions SET started_at=started_at-120000 WHERE id=?1", [id])?)).unwrap();
        db.end_session(id, wpm * 2.0, "words").unwrap();
    }
    let s = db.reading_speed(Some(&b.id)).unwrap();
    assert!((s.words_per_minute - 300.0).abs() < 5.0, "{}", s.words_per_minute);
}

#[test]
fn backup_wipe_restore_round_trip() {
    let t = tempfile::tempdir().unwrap();
    let dir = t.path().join("data");
    let db = Db::open(&dir).unwrap();
    let b = open(&db, &pdf(t.path(), "bk.pdf", "backup"));
    db.save_cover(&b.id, b"RIFF....WEBPcoverbytes", "webp").unwrap();
    db.save_progress(&b.id, &json!({"kind":"fixed","page":3}), 0.3).unwrap();
    db.set_setting("theme", &json!("sepia")).unwrap();
    let file = t.path().join("my.quire-backup");
    db.backup(&file).unwrap();
    assert!(file.exists());

    // wipe: lose everything
    db.remove_book(&b.id).unwrap();
    db.set_setting("theme", &json!(null)).unwrap();
    fs::remove_file(db.cover_file(&b.id).unwrap()).unwrap();
    db.with(|c| Ok(c.execute("DELETE FROM progress", [])?)).unwrap();

    db.restore(&file).unwrap();
    assert_eq!(db.get_progress(&b.id).unwrap().unwrap().fraction, 0.3);
    assert_eq!(db.get_setting("theme").unwrap().unwrap(), "sepia");
    assert_eq!(db.list_books(&ListQuery::default()).unwrap().len(), 1);
    assert_eq!(fs::read(db.cover_file(&b.id).unwrap()).unwrap(), b"RIFF....WEBPcoverbytes");
    assert!(!dir.join("quire.db.bak").exists() && !dir.join("covers.bak").exists());

    // garbage is refused and leaves data alone
    let bad = t.path().join("bad.quire-backup");
    fs::write(&bad, b"not a zip").unwrap();
    assert!(db.restore(&bad).is_err());
    assert_eq!(db.list_books(&ListQuery::default()).unwrap().len(), 1);
}

// ---- watched folders ----------------------------------------------------------------------

fn core_with_events(t: &Path) -> (Arc<Core>, mpsc::Receiver<CoreEvent>) {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    let emit: quire_lib::backend::Emitter = Arc::new(move |e| { let _ = tx.lock().unwrap().send(e); });
    (Arc::new(Core::new(&t.join("data"), emit).unwrap()), rx)
}

/// Poll `cond` (draining events) until true or timeout.
fn wait_for(rx: &mpsc::Receiver<CoreEvent>, mut cond: impl FnMut() -> bool) {
    let end = Instant::now() + Duration::from_secs(20);
    while Instant::now() < end {
        if cond() { return; }
        let _ = rx.recv_timeout(Duration::from_millis(200));
    }
    panic!("timed out waiting for condition");
}

#[test]
fn watched_folder_ingests_deletes_and_renames() {
    let t = tempfile::tempdir().unwrap();
    let watched = t.path().join("watched");
    fs::create_dir_all(watched.join("nested")).unwrap();
    pdf(&watched, "first.pdf", "pre-existing");
    let (core, rx) = core_with_events(t.path());
    let count = |c: &Core| c.db.list_books(&ListQuery::default()).unwrap().len();

    core.add_watched_folder(watched.to_str().unwrap()).unwrap();
    wait_for(&rx, || count(&core) == 1);
    assert_eq!(core.db.list_watched_folders().unwrap().len(), 1);

    // new file appears (in a subfolder) -> ingested + library-changed
    let nested = pdf(&watched.join("nested"), "second.pdf", "created later");
    wait_for(&rx, || count(&core) == 2);
    // loose images are not ingested as books
    fs::write(watched.join("pic.png"), png(10, 10, 1)).unwrap();

    // rename within the folder -> same book, new path
    let book = core.db.list_books(&ListQuery::default()).unwrap().into_iter().find(|b| b.title == "second").unwrap();
    let renamed = watched.join("nested").join("second-renamed.pdf");
    fs::rename(&nested, &renamed).unwrap();
    wait_for(&rx, || core.db.get_book(&book.id).unwrap().path.is_some_and(|p| p.ends_with("second-renamed.pdf")));
    assert_eq!(count(&core), 2);
    assert!(core.db.get_book(&book.id).unwrap().available);

    // delete -> unavailable, never removed
    fs::remove_file(&renamed).unwrap();
    wait_for(&rx, || !core.db.get_book(&book.id).unwrap().available);
    assert_eq!(count(&core), 2);
    assert!(core.db.get_book(&book.id).is_ok());
}

#[test]
fn rescan_marks_files_deleted_while_closed() {
    let t = tempfile::tempdir().unwrap();
    let watched = t.path().join("w");
    fs::create_dir_all(&watched).unwrap();
    let f = pdf(&watched, "gone.pdf", "offline delete");
    let (core, rx) = core_with_events(t.path());
    core.add_watched_folder(watched.to_str().unwrap()).unwrap();
    wait_for(&rx, || core.db.list_books(&ListQuery::default()).unwrap().len() == 1);
    let id = core.db.list_books(&ListQuery::default()).unwrap()[0].id.clone();
    fs::remove_file(&f).unwrap();
    quire_lib::backend::watcher::scan_folder(&core.db, &core.emit, &watched).unwrap();
    assert!(!core.db.get_book(&id).unwrap().available);
}

#[test]
fn restore_book_undoes_a_removal_without_touching_last_read() {
    let (t, db) = new_db();
    let b = open(&db, &pdf(t.path(), "Dune.pdf", "dune"));
    db.save_progress(&b.id, &json!({"kind":"fixed","page":2}), 0.4).unwrap();
    let before = db.get_book(&b.id).unwrap().last_opened_at;
    db.remove_book(&b.id).unwrap();
    assert!(db.list_books(&ListQuery::default()).unwrap().is_empty());
    db.restore_book(&b.id).unwrap();
    let back = db.get_book(&b.id).unwrap();
    assert_eq!(back.last_opened_at, before, "restoring is not reading");
    assert_eq!(db.list_books(&ListQuery::default()).unwrap().len(), 1);
    assert!(db.get_progress(&b.id).unwrap().is_some(), "progress kept");
    assert!(db.restore_book("nope").is_err());
}

#[test]
fn writes_are_durable_wal_with_full_sync() {
    let (_t, db) = new_db();
    let (mode, sync): (String, i64) = db
        .with(|c| Ok((c.query_row("PRAGMA journal_mode", [], |r| r.get(0))?, c.query_row("PRAGMA synchronous", [], |r| r.get(0))?)))
        .unwrap();
    assert_eq!(mode, "wal");
    assert_eq!(sync, 2, "FULL: a committed progress/annotation write survives a power cut");
    db.set_setting("k", &json!(1)).unwrap();
    db.checkpoint(); // shutdown folds the WAL into the file
    assert_eq!(db.get_all_settings().unwrap().len(), 1);
}
