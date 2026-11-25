//! Files on disk: format sniffing, fingerprints, cheap metadata/cover extraction, and the
//! register (upsert + re-link) path shared by `open_document` and watched-folder ingestion.

use std::cmp::Ordering;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use base64::Engine as _;
use quick_xml::events::Event;
use quick_xml::Reader;
use rusqlite::{params, OptionalExtension};

use super::db::{get_book_c, strip_verbatim, Db};
use super::error::{Error, ErrorCode, Res};
use super::model::*;

const MIB: u64 = 1024 * 1024;
pub const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "tif", "tiff"];
/// Extensions a watched-folder scan considers (loose images are deliberately excluded).
pub const DOC_EXTS: &[&str] = &["pdf", "epub", "mobi", "azw", "azw3", "fb2", "fbz", "cbz", "cbr"];

fn ext_of(p: &Path) -> String {
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}
pub fn is_image_name(name: &str) -> bool {
    IMAGE_EXTS.contains(&ext_of(Path::new(name)).as_str())
}
pub fn is_doc_ext(p: &Path) -> bool {
    DOC_EXTS.contains(&ext_of(p).as_str())
}

// ---- natural ordering ---------------------------------------------------------------------

pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let mut na = String::new();
                let mut nb = String::new();
                while let Some(c) = a.next_if(|c| c.is_ascii_digit()) { na.push(c); }
                while let Some(c) = b.next_if(|c| c.is_ascii_digit()) { nb.push(c); }
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let o = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if o != Ordering::Equal { return o; }
            }
            (Some(x), Some(y)) => {
                let o = x.to_lowercase().cmp(y.to_lowercase());
                if o != Ordering::Equal { return o; }
                a.next();
                b.next();
            }
        }
    }
}

/// Image files directly inside `dir`, naturally sorted (page2 before page10).
pub fn list_image_folder(dir: &Path) -> Res<Vec<PathBuf>> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_image_name(&p.to_string_lossy()))
        .collect();
    v.sort_by(|a, b| natural_cmp(&a.file_name().unwrap_or_default().to_string_lossy(), &b.file_name().unwrap_or_default().to_string_lossy()));
    Ok(v)
}

// ---- fingerprint --------------------------------------------------------------------------

/// BLAKE3 over (size LE bytes, first 1 MiB, last 1 MiB).
pub fn fingerprint(path: &Path) -> Res<String> {
    let mut f = File::open(path)?;
    let len = f.metadata()?.len();
    let mut h = blake3::Hasher::new();
    h.update(&len.to_le_bytes());
    let mut buf = vec![0u8; MIB.min(len) as usize];
    f.read_exact(&mut buf)?;
    h.update(&buf);
    if len > MIB {
        let tail = MIB.min(len - MIB) as usize; // don't re-hash the head for files between 1 and 2 MiB
        f.seek(SeekFrom::End(-(tail as i64)))?;
        buf.resize(tail, 0);
        f.read_exact(&mut buf)?;
        h.update(&buf);
    }
    Ok(h.finalize().to_hex().to_string())
}

/// Folder of images: hash of the sorted (name, size) list.
pub fn folder_fingerprint(images: &[PathBuf]) -> Res<(String, u64)> {
    let mut h = blake3::Hasher::new();
    h.update(b"folder\0");
    let mut total = 0;
    for p in images {
        let size = std::fs::metadata(p)?.len();
        total += size;
        h.update(p.file_name().unwrap_or_default().to_string_lossy().to_lowercase().as_bytes());
        h.update(&[0]);
        h.update(&size.to_le_bytes());
    }
    Ok((h.finalize().to_hex().to_string(), total))
}

// ---- sniffing -----------------------------------------------------------------------------

pub fn sniff(path: &Path) -> Res<Format> {
    let mut f = File::open(path)?;
    let mut head = vec![0u8; 16 * 1024];
    let n = f.read(&mut head)?;
    head.truncate(n);
    let unsupported = || Error::new(ErrorCode::Unsupported, "Quire can't read this kind of file yet.");
    let starts = |s: &[u8], at: usize| head.get(at..at + s.len()) == Some(s);
    let latin = |a: usize, b: usize| head[a.min(head.len())..b.min(head.len())].iter().map(|&c| c as char).collect::<String>();

    if latin(0, 1024).contains("%PDF-") { return Ok(Format::Pdf); }
    if starts(b"Rar!\x1a\x07", 0) { return Ok(Format::Cbr); }
    if starts(b"PK\x03\x04", 0) || starts(b"PK\x05\x06", 0) { return sniff_zip(path).ok_or_else(unsupported); }
    if starts(b"BOOKMOBI", 60) {
        if head.len() >= 82 {
            let rec0 = u32::from_be_bytes(head[78..82].try_into().unwrap()) as usize;
            if rec0 + 40 <= head.len() && starts(b"MOBI", rec0 + 16) && head[rec0 + 36..rec0 + 40] == [0, 0, 0, 8] {
                return Ok(Format::Azw3);
            }
        }
        return Ok(Format::Mobi);
    }
    let img = starts(&[0x89, b'P', b'N', b'G'], 0) || starts(&[0xff, 0xd8, 0xff], 0) || starts(b"GIF8", 0)
        || (starts(b"RIFF", 0) && starts(b"WEBP", 8))
        || (starts(b"ftyp", 4) && (starts(b"avif", 8) || starts(b"avis", 8)))
        || starts(&[0x49, 0x49, 0x2a, 0], 0) || starts(&[0x4d, 0x4d, 0, 0x2a], 0) || starts(b"BM", 0) && head.len() > 18;
    if img { return Ok(Format::Image); }
    if latin(0, 4096).contains("<FictionBook") { return Ok(Format::Fb2); }
    Err(unsupported())
}

fn sniff_zip(path: &Path) -> Option<Format> {
    let mut z = zip::ZipArchive::new(File::open(path).ok()?).ok()?;
    let names: Vec<String> = (0..z.len()).filter_map(|i| z.by_index_raw(i).ok().map(|e| e.name().to_string())).collect();
    if names.iter().any(|n| n == "META-INF/container.xml") { return Some(Format::Epub); }
    let files: Vec<&String> = names.iter().filter(|n| !n.ends_with('/')).collect();
    if files.iter().any(|n| n.to_lowercase().ends_with(".fb2")) && files.len() <= 3 { return Some(Format::Fbz); }
    let imgs = files.iter().filter(|n| is_image_name(n)).count();
    (imgs > 0 && imgs * 2 >= files.len()).then_some(Format::Cbz)
}

// ---- metadata and cover extraction --------------------------------------------------------

#[derive(Default, Debug)]
pub struct Extracted {
    pub title: Option<String>,
    pub author: Option<String>,
    /// Already thumbnailed (JPEG).
    pub cover: Option<Vec<u8>>,
}

/// ~400px-tall JPEG thumbnail. (The `image` crate's WebP encoder is lossless-only: too big for covers.)
pub fn thumbnail(bytes: &[u8]) -> Option<Vec<u8>> {
    let img = image::load_from_memory(bytes).ok()?;
    let img = if img.height() > 400 { img.resize(u32::MAX, 400, image::imageops::FilterType::Triangle) } else { img };
    let mut out = vec![];
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85).encode_image(&image::DynamicImage::ImageRgb8(img.to_rgb8())).ok()?;
    Some(out)
}

pub fn extract(path: &Path, format: Format) -> Extracted {
    let r = match format {
        Format::Epub => extract_epub(path),
        Format::Fb2 => std::fs::read(path).ok().filter(|b| b.len() < 128 * MIB as usize).map(|b| parse_fb2(&b)),
        Format::Fbz => zip_first_matching(path, |n| n.to_lowercase().ends_with(".fb2")).map(|b| parse_fb2(&b)),
        Format::Cbz => zip_first_image(path).map(|b| Extracted { cover: thumbnail(&b), ..Default::default() }),
        Format::Image => {
            let dir = if path.is_dir() { path } else { path.parent().unwrap_or(path) };
            list_image_folder(dir).ok().and_then(|v| v.first().and_then(|p| std::fs::read(p).ok())).map(|b| Extracted { cover: thumbnail(&b), ..Default::default() })
        }
        _ => None, // PDF / MOBI / AZW3 / CBR: the frontend engine renders the cover (needs_cover stays set)
    };
    r.unwrap_or_default()
}

fn zip_first_matching(path: &Path, pred: impl Fn(&str) -> bool) -> Option<Vec<u8>> {
    let mut z = zip::ZipArchive::new(File::open(path).ok()?).ok()?;
    let idx = (0..z.len()).find(|&i| z.by_index_raw(i).map(|e| pred(e.name())).unwrap_or(false))?;
    read_entry(&mut z, idx)
}
fn read_entry(z: &mut zip::ZipArchive<File>, idx: usize) -> Option<Vec<u8>> {
    let mut e = z.by_index(idx).ok()?;
    if e.size() > 256 * MIB { return None; }
    let mut v = Vec::with_capacity(e.size() as usize);
    e.read_to_end(&mut v).ok()?;
    Some(v)
}
fn zip_by_name(z: &mut zip::ZipArchive<File>, name: &str) -> Option<Vec<u8>> {
    let idx = z.index_for_name(name)?;
    read_entry(z, idx)
}
fn zip_first_image(path: &Path) -> Option<Vec<u8>> {
    let mut z = zip::ZipArchive::new(File::open(path).ok()?).ok()?;
    let mut names: Vec<(usize, String)> = (0..z.len())
        .filter_map(|i| z.by_index_raw(i).ok().map(|e| (i, e.name().to_string())))
        .filter(|(_, n)| !n.ends_with('/') && !n.contains("__MACOSX") && is_image_name(n))
        .collect();
    names.sort_by(|a, b| natural_cmp(&a.1, &b.1));
    read_entry(&mut z, names.first()?.0)
}

fn local(e: &quick_xml::events::BytesStart) -> String {
    String::from_utf8_lossy(e.local_name().as_ref()).into_owned()
}
fn attr(e: &quick_xml::events::BytesStart, key: &str) -> Option<String> {
    e.attributes().flatten().find(|a| a.key.local_name().as_ref() == key.as_bytes()).map(|a| String::from_utf8_lossy(&a.value).into_owned())
}
/// Text of a `Text` event, or a predefined entity from `GeneralRef` (quick-xml splits at `&amp;`).
fn text_piece(ev: &Event) -> Option<String> {
    match ev {
        Event::Text(t) => t.decode().ok().map(|c| c.into_owned()),
        Event::CData(t) => t.decode().ok().map(|c| c.into_owned()),
        Event::GeneralRef(r) => {
            let n = r.decode().ok()?;
            Some(match n.as_ref() {
                "amp" => "&".into(),
                "lt" => "<".into(),
                "gt" => ">".into(),
                "quot" => "\"".into(),
                "apos" => "'".into(),
                other => other.strip_prefix('#').and_then(|d| {
                    let code = d.strip_prefix('x').map(|h| u32::from_str_radix(h, 16).ok()).unwrap_or_else(|| d.parse().ok())?;
                    char::from_u32(code).map(|c| c.to_string())
                })?,
            })
        }
        _ => None,
    }
}

fn extract_epub(path: &Path) -> Option<Extracted> {
    let mut z = zip::ZipArchive::new(File::open(path).ok()?).ok()?;
    let container = zip_by_name(&mut z, "META-INF/container.xml")?;
    let opf_path = {
        let mut r = Reader::from_reader(container.as_slice());
        let mut found = None;
        while let Ok(ev) = r.read_event() {
            match ev {
                Event::Start(e) | Event::Empty(e) if local(&e) == "rootfile" => { found = attr(&e, "full-path"); break; }
                Event::Eof => break,
                _ => {}
            }
        }
        found?
    };
    let opf = zip_by_name(&mut z, &opf_path)?;
    let mut out = Extracted::default();
    let (mut cover_id, mut cover_href, mut items) = (None::<String>, None::<String>, vec![]);
    let mut r = Reader::from_reader(opf.as_slice());
    let mut cur = String::new();
    let (mut title, mut author) = (String::new(), String::new());
    let (mut title_done, mut author_done) = (false, false);
    loop {
        let ev = r.read_event().ok()?;
        match &ev {
            Event::Start(e) | Event::Empty(e) => {
                cur = local(e);
                match cur.as_str() {
                    "meta" if attr(e, "name").as_deref() == Some("cover") => cover_id = attr(e, "content"),
                    "item" => {
                        let (id, href) = (attr(e, "id").unwrap_or_default(), attr(e, "href").unwrap_or_default());
                        if attr(e, "properties").is_some_and(|p| p.split_whitespace().any(|x| x == "cover-image")) {
                            cover_href = Some(href.clone());
                        }
                        items.push((id, href));
                    }
                    _ => {}
                }
            }
            Event::End(e) => {
                match e.local_name().as_ref() {
                    b"title" => title_done |= !title.trim().is_empty(),
                    b"creator" => author_done |= !author.trim().is_empty(),
                    _ => {}
                }
                cur.clear();
            }
            Event::Eof => break,
            ev => {
                if let Some(t) = text_piece(ev) {
                    if cur == "title" && !title_done { title.push_str(&t) }
                    if cur == "creator" && !author_done { author.push_str(&t) }
                }
            }
        }
    }
    out.title = Some(title.trim().to_string()).filter(|s| !s.is_empty());
    out.author = Some(author.trim().to_string()).filter(|s| !s.is_empty());
    let href = cover_href.or_else(|| cover_id.and_then(|id| items.iter().find(|(i, _)| *i == id).map(|(_, h)| h.clone())));
    if let Some(h) = href {
        let h = percent_encoding::percent_decode_str(&h).decode_utf8_lossy().into_owned();
        let base = opf_path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        let mut parts: Vec<&str> = base.split('/').filter(|s| !s.is_empty()).collect();
        for seg in h.split('/') {
            match seg { ".." => { parts.pop(); } "." | "" => {} s => parts.push(s) }
        }
        out.cover = zip_by_name(&mut z, &parts.join("/")).and_then(|b| thumbnail(&b));
    }
    Some(out)
}

fn parse_fb2(bytes: &[u8]) -> Extracted {
    let mut out = Extracted::default();
    let mut r = Reader::from_reader(bytes);
    let (mut stack, mut cover_id, mut bin_id) = (Vec::<String>::new(), None::<String>, None::<String>);
    let (mut title, mut first, mut last, mut bin) = (String::new(), String::new(), String::new(), String::new());
    let mut author_done = false;
    while let Ok(ev) = r.read_event() {
        match &ev {
            Event::Start(e) => {
                let n = local(e);
                if n == "binary" { bin_id = attr(e, "id"); bin.clear(); }
                stack.push(n);
            }
            Event::Empty(e) if local(e) == "image" && stack.iter().any(|s| s == "coverpage") => {
                cover_id = attr(e, "href").map(|h| h.trim_start_matches('#').to_string());
            }
            Event::End(e) => {
                let n = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                if n == "author" && stack.iter().any(|s| s == "title-info") && !author_done && !(first.is_empty() && last.is_empty()) {
                    out.author = Some(format!("{} {}", first.trim(), last.trim()).trim().to_string());
                    author_done = true;
                }
                if n == "binary" && bin_id.is_some() && bin_id == cover_id {
                    let clean: String = bin.chars().filter(|c| !c.is_whitespace()).collect();
                    out.cover = base64::engine::general_purpose::STANDARD.decode(clean).ok().and_then(|b| thumbnail(&b));
                    break;
                }
                stack.pop();
            }
            Event::Eof => break,
            ev => {
                if let Some(t) = text_piece(ev) {
                    let top = stack.last().map(String::as_str).unwrap_or("");
                    let in_ti = stack.iter().any(|s| s == "title-info");
                    match top {
                        "book-title" if in_ti && out.title.is_none() => title.push_str(&t),
                        "first-name" if in_ti && !author_done => first.push_str(&t),
                        "last-name" if in_ti && !author_done => last.push_str(&t),
                        "binary" => bin.push_str(&t),
                        _ => {}
                    }
                    if top != "book-title" && !title.is_empty() && out.title.is_none() { out.title = Some(title.trim().to_string()); }
                }
            }
        }
    }
    if out.title.is_none() && !title.trim().is_empty() { out.title = Some(title.trim().to_string()); }
    out
}

// ---- register (upsert + re-link) ----------------------------------------------------------

pub struct Registered {
    pub book: Book,
    pub created: bool,
    pub start_image: Option<PathBuf>,
}

impl Db {
    /// Add or re-link the book at `input`. `opened`: the user opened it (bumps last_opened_at and
    /// un-removes it); false for background ingestion, which leaves removed books alone.
    pub fn register(&self, input: &Path, opened: bool) -> Res<Option<Registered>> {
        let canon = strip_verbatim(&std::fs::canonicalize(input)?);
        let (path, format, fp, size, start_image) = if canon.is_dir() || is_image_file(&canon) {
            let (dir, start) = if canon.is_dir() { (canon.clone(), None) } else { (canon.parent().unwrap().to_path_buf(), Some(canon.clone())) };
            let imgs = list_image_folder(&dir)?;
            if imgs.is_empty() {
                return Err(Error::new(ErrorCode::Unsupported, "There are no images in that folder."));
            }
            let (fp, size) = folder_fingerprint(&imgs)?;
            (dir, Format::Image, fp, size, start)
        } else {
            let format = sniff(&canon)?;
            if format == Format::Image { unreachable!("handled by is_image_file") }
            (canon.clone(), format, fingerprint(&canon)?, std::fs::metadata(&canon)?.len(), None)
        };
        let path_s = path.to_string_lossy().into_owned();
        let now = now_ms();

        let existing: Option<(String, bool)> = self.with(|c| {
            Ok(c.query_row("SELECT id, removed FROM books WHERE fingerprint=?1", [&fp], |r| Ok((r.get(0)?, r.get(1)?))).optional()?)
        })?;
        if let Some((_, true)) = existing {
            if !opened { return Ok(None); }
        }

        let (id, created) = match existing {
            Some((id, _)) => (id, false),
            None => {
                let ex = extract(&path, format);
                let id = uuid::Uuid::new_v4().to_string();
                let stem = path.file_stem().or(path.file_name()).map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                let cover_name = ex.cover.as_ref().map(|b| -> Res<String> {
                    let n = format!("{id}.jpg");
                    std::fs::create_dir_all(self.covers_dir())?;
                    std::fs::write(self.covers_dir().join(&n), b)?;
                    Ok(n)
                }).transpose()?;
                let inserted = self.tx(|t| {
                    let n = t.execute(
                        "INSERT OR IGNORE INTO books(id,fingerprint,format,title,author,cover_path,cover_rev,needs_cover,added_at,file_size) \
                         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                        params![id, fp, format.as_str(), ex.title.filter(|t| !t.is_empty()).unwrap_or(stem), ex.author.unwrap_or_default(),
                                cover_name, cover_name.is_some() as i32, cover_name.is_none(), now, size as f64],
                    )?;
                    Ok(n == 1)
                })?;
                if inserted {
                    (id, true)
                } else {
                    // lost a race with another ingest of the same content
                    if let Some(n) = &cover_name { let _ = std::fs::remove_file(self.covers_dir().join(n)); }
                    let id = self.with(|c| Ok(c.query_row("SELECT id FROM books WHERE fingerprint=?1", [&fp], |r| r.get::<_, String>(0))?))?;
                    (id, false)
                }
            }
        };

        self.tx(|t| {
            t.execute(
                "INSERT INTO book_paths(book_id,path,last_seen_at,available) VALUES(?1,?2,?3,1) \
                 ON CONFLICT(path) DO UPDATE SET book_id=?1, last_seen_at=?3, available=1",
                params![id, path_s, now],
            )?;
            if opened {
                t.execute("UPDATE books SET removed=0, last_opened_at=?2 WHERE id=?1", params![id, now])?;
            }
            Ok(())
        })?;
        // A move/rename leaves the old path behind: mark whichever other paths vanished.
        let others: Vec<String> = self.with(|c| {
            let mut s = c.prepare("SELECT path FROM book_paths WHERE book_id=?1 AND path<>?2 AND available=1")?;
            let v = s.query_map(params![id, path_s], |r| r.get(0))?.collect::<Result<Vec<String>, _>>()?;
            Ok(v)
        })?;
        let gone: Vec<String> = others.into_iter().filter(|p| !Path::new(p).exists()).collect();
        if !gone.is_empty() {
            self.tx(|t| {
                for p in &gone { t.execute("UPDATE book_paths SET available=0 WHERE path=?1", [p])?; }
                Ok(())
            })?;
        }
        let book = self.get_book(&id)?;
        Ok(Some(Registered { book, created, start_image }))
    }

    /// Stat every known path and fix `available`. Returns ids of books whose availability changed.
    pub fn refresh_availability(&self) -> Res<Vec<String>> {
        let rows: Vec<(String, String, bool)> = self.with(|c| {
            let mut s = c.prepare("SELECT book_id, path, available FROM book_paths")?;
            let v = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })?;
        let changes: Vec<(String, String, bool)> = rows
            .into_iter()
            .filter_map(|(b, p, was)| {
                let now = Path::new(&p).exists();
                (now != was).then_some((b, p, now))
            })
            .collect();
        self.tx(|t| {
            for (_, p, now) in &changes {
                t.execute("UPDATE book_paths SET available=?2 WHERE path=?1", params![p, now])?;
            }
            Ok(())
        })?;
        let mut ids: Vec<String> = changes.into_iter().map(|c| c.0).collect();
        ids.sort();
        ids.dedup();
        Ok(ids)
    }

    /// A path (or a whole folder tree) disappeared. Returns affected book ids.
    pub fn mark_unavailable(&self, path: &Path) -> Res<Vec<String>> {
        let p = strip_verbatim(path).to_string_lossy().into_owned();
        let sep = std::path::MAIN_SEPARATOR;
        self.tx(|t| {
            let mut s = t.prepare(
                "SELECT DISTINCT book_id FROM book_paths WHERE available=1 AND (path=?1 OR substr(path,1,length(?1)+1)=?1||?2)",
            )?;
            let ids = s.query_map(params![p, sep.to_string()], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            drop(s);
            t.execute(
                "UPDATE book_paths SET available=0 WHERE path=?1 OR substr(path,1,length(?1)+1)=?1||?2",
                params![p, sep.to_string()],
            )?;
            Ok(ids)
        })
    }

    pub fn book_exists(&self, id: &str) -> bool {
        self.with(|c| get_book_c(c, id).map(|_| ())).is_ok()
    }
}

fn is_image_file(p: &Path) -> bool {
    p.is_file() && matches!(sniff(p), Ok(Format::Image))
}
