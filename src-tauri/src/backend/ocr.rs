//! OCR through the Windows built-in engine (`Windows.Media.Ocr`, using the language packs installed in
//! Windows) or, on Linux, the system Tesseract; offline either way. Page bitmaps come from the frontend (rendered by the PDF
//! Engine); words come back with boxes normalised 0..1 to the page and are cached in `ocr_pages`,
//! so a book is only ever OCR'd once.

use std::sync::Arc;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

use super::db::Db;
use super::error::{Error, ErrorCode, Res};
use super::model::*;
use super::Core;

/// One recognised word. `x`,`y`,`width`,`height` are fractions (0..1) of the page image,
/// origin top-left.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct OcrWordN {
    pub text: String,
    #[specta(type = specta_typescript::Number)]
    pub x: f64,
    #[specta(type = specta_typescript::Number)]
    pub y: f64,
    #[specta(type = specta_typescript::Number)]
    pub width: f64,
    #[specta(type = specta_typescript::Number)]
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OcrPage {
    /// 0-based page (or image) index.
    pub page: u32,
    /// BCP-47 tag of the recogniser that produced it.
    pub lang: String,
    pub words: Vec<OcrWordN>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OcrLanguage {
    /// BCP-47 tag, e.g. `en-US`; pass as `lang`.
    pub tag: String,
    pub name: String,
    /// What OCR uses when no language is given (the user's profile languages).
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OcrStatus {
    /// Pages with cached OCR results.
    pub pages_done: u32,
    pub lang: Option<String>,
}

impl Db {
    pub fn ocr_store(&self, book_id: &str, p: &OcrPage) -> Res<()> {
        self.tx(|t| {
            t.execute(
                "INSERT INTO ocr_pages(book_id,page,words,lang,created_at) VALUES(?1,?2,?3,?4,?5) \
                 ON CONFLICT(book_id,page) DO UPDATE SET words=?3, lang=?4, created_at=?5",
                params![book_id, p.page, serde_json::to_string(&p.words)?, p.lang, now_ms()],
            )
            .map_err(|_| Error::not_found("that book"))?;
            Ok(())
        })
    }

    pub fn ocr_pages(&self, book_id: &str) -> Res<Vec<OcrPage>> {
        self.with(|c| {
            let mut s = c.prepare("SELECT page, words, COALESCE(lang,'') FROM ocr_pages WHERE book_id=?1 ORDER BY page")?;
            let v = s
                .query_map([book_id], |r| {
                    let words: String = r.get(1)?;
                    Ok(OcrPage { page: r.get(0)?, lang: r.get(2)?, words: serde_json::from_str(&words).unwrap_or_default() })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
    }

    pub fn ocr_status(&self, book_id: &str) -> Res<OcrStatus> {
        self.with(|c| {
            Ok(c.query_row(
                "SELECT COUNT(*), MAX(lang) FROM ocr_pages WHERE book_id=?1",
                [book_id],
                |r| Ok(OcrStatus { pages_done: r.get(0)?, lang: r.get(1)? }),
            )?)
        })
    }

    pub fn clear_ocr(&self, book_id: &str) -> Res<()> {
        self.tx(|t| {
            t.execute("DELETE FROM ocr_pages WHERE book_id=?1", [book_id])?;
            Ok(())
        })
    }
}

/// Pixels of a page: raw RGBA (`len == width*height*4`) or an encoded PNG/JPEG/WebP.
pub fn decode_pixels(bytes: &[u8], width: u32, height: u32) -> Res<(Vec<u8>, u32, u32)> {
    if width > 0 && height > 0 && bytes.len() as u64 == width as u64 * height as u64 * 4 {
        return Ok((bytes.to_vec(), width, height));
    }
    let img = image::load_from_memory(bytes).map_err(|e| Error::invalid(format!("That page image couldn't be read ({e}).")))?.to_rgba8();
    let (w, h) = img.dimensions();
    Ok((img.into_raw(), w, h))
}

#[cfg(windows)]
mod win {
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    use super::*;

    fn fail(what: &str, e: windows::core::Error) -> Error {
        Error::new(ErrorCode::Unsupported, format!("Windows text recognition failed while {what} ({e})."))
    }
    fn no_language() -> Error {
        Error::new(ErrorCode::Unsupported, "Windows has no text-recognition language installed. Add one under Settings > Time & language > Language & region.")
    }

    fn init() {
        // MTA so `.get()` can block on async operations; harmless if the thread is already set up.
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    }

    fn make_engine(lang: Option<&str>) -> Res<OcrEngine> {
        let wanted = match lang.filter(|l| !l.is_empty()) {
            Some(tag) => Language::CreateLanguage(&HSTRING::from(tag)).and_then(|l| OcrEngine::TryCreateFromLanguage(&l)),
            None => OcrEngine::TryCreateFromUserProfileLanguages(),
        };
        if let Ok(e) = wanted {
            return Ok(e);
        }
        // The profile language has no OCR pack: fall back to any installed one rather than fail.
        let all = OcrEngine::AvailableRecognizerLanguages().map_err(|e| fail("listing languages", e))?;
        (0..all.Size().unwrap_or(0))
            .filter_map(|i| all.GetAt(i).ok())
            .find_map(|l| OcrEngine::TryCreateFromLanguage(&l).ok())
            .ok_or_else(no_language)
    }

    pub fn languages() -> Res<Vec<OcrLanguage>> {
        init();
        let default = OcrEngine::TryCreateFromUserProfileLanguages().ok().and_then(|e| e.RecognizerLanguage().ok()).and_then(|l| l.LanguageTag().ok()).map(|t| t.to_string());
        let all = OcrEngine::AvailableRecognizerLanguages().map_err(|e| fail("listing languages", e))?;
        Ok((0..all.Size().unwrap_or(0))
            .filter_map(|i| all.GetAt(i).ok())
            .filter_map(|l| {
                let tag = l.LanguageTag().ok()?.to_string();
                Some(OcrLanguage { name: l.DisplayName().map(|n| n.to_string()).unwrap_or_else(|_| tag.clone()), default: default.as_deref() == Some(tag.as_str()), tag })
            })
            .collect())
    }

    pub fn recognize(rgba: &[u8], width: u32, height: u32, lang: Option<&str>) -> Res<(Vec<OcrWordN>, String)> {
        init();
        let engine = make_engine(lang)?;
        let max = OcrEngine::MaxImageDimension().unwrap_or(2600);
        if width == 0 || height == 0 || width > max || height > max {
            return Err(Error::invalid(format!("Page images must be between 1 and {max} pixels on each side.")));
        }
        let bgra: Vec<u8> = rgba.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0], p[3]]).collect();
        let writer = DataWriter::new().map_err(|e| fail("preparing the page", e))?;
        writer.WriteBytes(&bgra).map_err(|e| fail("preparing the page", e))?;
        let buffer = writer.DetachBuffer().map_err(|e| fail("preparing the page", e))?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, width as i32, height as i32).map_err(|e| fail("preparing the page", e))?;
        let result = engine.RecognizeAsync(&bitmap).and_then(|op| op.get()).map_err(|e| fail("reading the page", e))?;
        let tag = engine.RecognizerLanguage().and_then(|l| l.LanguageTag()).map(|t| t.to_string()).unwrap_or_default();
        let (w, h) = (width as f64, height as f64);
        let r4 = |v: f64| (v * 10_000.0).round() / 10_000.0;
        let mut words = vec![];
        let lines = result.Lines().map_err(|e| fail("reading the page", e))?;
        for i in 0..lines.Size().unwrap_or(0) {
            let Ok(line) = lines.GetAt(i) else { continue };
            let Ok(ws) = line.Words() else { continue };
            for j in 0..ws.Size().unwrap_or(0) {
                let Ok(word) = ws.GetAt(j) else { continue };
                let (Ok(text), Ok(b)) = (word.Text(), word.BoundingRect()) else { continue };
                let text = text.to_string();
                if text.trim().is_empty() {
                    continue;
                }
                words.push(OcrWordN { text, x: r4(b.X as f64 / w), y: r4(b.Y as f64 / h), width: r4(b.Width as f64 / w), height: r4(b.Height as f64 / h) });
            }
        }
        Ok((words, tag))
    }
}

/// Linux: the `tesseract` CLI (Fedora `tesseract` + `tesseract-langpack-*`, Debian `tesseract-ocr-*`), fed a
/// grayscale PNG on stdin. Tags are Tesseract's own codes (`eng`, `deu`), which round-trip as `lang`.
#[cfg(target_os = "linux")]
mod tess {
    use std::io::Write;
    use std::process::{Command, Stdio};

    use super::*;

    const NAMES: &[(&str, &str, &str)] = &[
        ("eng", "en", "English"), ("deu", "de", "German"), ("fra", "fr", "French"), ("spa", "es", "Spanish"),
        ("ita", "it", "Italian"), ("por", "pt", "Portuguese"), ("nld", "nl", "Dutch"), ("swe", "sv", "Swedish"),
        ("pol", "pl", "Polish"), ("ces", "cs", "Czech"), ("rus", "ru", "Russian"), ("ukr", "uk", "Ukrainian"),
        ("tur", "tr", "Turkish"), ("ell", "el", "Greek"), ("ara", "ar", "Arabic"), ("fas", "fa", "Persian"),
        ("heb", "he", "Hebrew"), ("hin", "hi", "Hindi"), ("jpn", "ja", "Japanese"), ("kor", "ko", "Korean"),
        ("chi_sim", "zh", "Chinese (Simplified)"), ("chi_tra", "zh", "Chinese (Traditional)"),
    ];

    fn missing() -> Error {
        Error::new(ErrorCode::Unsupported, "Text recognition needs Tesseract. Install it with your package manager (Fedora: sudo dnf install tesseract).")
    }

    fn installed() -> Res<Vec<String>> {
        let out = Command::new("tesseract").arg("--list-langs").output().map_err(|_| missing())?;
        // Tesseract 3 lists on stderr, 4+ on stdout; the header line has spaces, codes never do.
        let text = [out.stdout, out.stderr].concat();
        Ok(String::from_utf8_lossy(&text).lines().map(str::trim).filter(|l| !l.is_empty() && !l.contains(' ') && *l != "osd" && *l != "equ").map(String::from).collect())
    }

    fn default_of(all: &[String]) -> Option<String> {
        let sys: String = std::env::var("LANG").unwrap_or_default().chars().take(2).collect();
        let has = |c: &str| all.iter().any(|a| a == c);
        NAMES.iter().find(|n| n.1 == sys && has(n.0)).map(|n| n.0).or(has("eng").then_some("eng")).map(String::from).or_else(|| all.first().cloned())
    }

    pub fn languages() -> Res<Vec<OcrLanguage>> {
        let Ok(all) = installed() else { return Ok(vec![]) };
        let def = default_of(&all);
        Ok(all
            .iter()
            .map(|t| OcrLanguage { name: NAMES.iter().find(|n| n.0 == t).map_or_else(|| t.clone(), |n| n.2.to_string()), default: def.as_deref() == Some(t.as_str()), tag: t.clone() })
            .collect())
    }

    pub fn recognize(rgba: &[u8], width: u32, height: u32, lang: Option<&str>) -> Res<(Vec<OcrWordN>, String)> {
        let all = installed()?;
        let tag = lang
            .filter(|l| all.iter().any(|a| a == l))
            .map(String::from)
            .or_else(|| default_of(&all))
            .ok_or_else(|| Error::new(ErrorCode::Unsupported, "Tesseract has no language installed (Fedora: sudo dnf install tesseract-langpack-eng)."))?;
        let img = image::RgbaImage::from_raw(width, height, rgba.to_vec()).ok_or_else(|| Error::invalid("That page image couldn't be read."))?;
        let mut png = vec![];
        image::DynamicImage::ImageRgba8(img).into_luma8().write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).map_err(|e| Error::invalid(format!("That page image couldn't be prepared ({e}).")))?;
        let mut child = Command::new("tesseract")
            .args(["stdin", "stdout", "-l", &tag, "tsv"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| missing())?;
        // tesseract reads the whole image before writing anything, so writing first cannot deadlock
        child.stdin.take().expect("piped").write_all(&png)?;
        let out = child.wait_with_output()?;
        if !out.status.success() {
            let why = String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("").trim().to_string();
            return Err(Error::new(ErrorCode::Unsupported, format!("Tesseract couldn't read the page ({why}).")));
        }
        Ok((parse_tsv(&String::from_utf8_lossy(&out.stdout), width as f64, height as f64), tag))
    }
}

/// Words (TSV level 5) from `tesseract ... tsv` output, boxes normalised to the image.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_tsv(tsv: &str, w: f64, h: f64) -> Vec<OcrWordN> {
    let r4 = |v: f64| (v * 10_000.0).round() / 10_000.0;
    tsv.lines()
        .filter_map(|l| {
            let c: Vec<&str> = l.splitn(12, '\t').collect();
            let text = c.get(11)?.trim();
            if c[0] != "5" || text.is_empty() {
                return None;
            }
            let n = |i: usize| c[i].parse::<f64>().ok();
            Some(OcrWordN { text: text.to_string(), x: r4(n(6)? / w), y: r4(n(7)? / h), width: r4(n(8)? / w), height: r4(n(9)? / h) })
        })
        .collect()
}

/// Languages the OS recogniser can use right now (empty when none is installed).
pub fn languages() -> Res<Vec<OcrLanguage>> {
    #[cfg(windows)]
    return win::languages();
    #[cfg(target_os = "linux")]
    return tess::languages();
    #[cfg(not(any(windows, target_os = "linux")))]
    Ok(vec![])
}

/// Blocking: decode, recognise, return normalised words and the language used.
pub fn recognize(bytes: &[u8], width: u32, height: u32, lang: Option<&str>) -> Res<(Vec<OcrWordN>, String)> {
    let (rgba, w, h) = decode_pixels(bytes, width, height)?;
    #[cfg(windows)]
    return win::recognize(&rgba, w, h, lang);
    #[cfg(target_os = "linux")]
    return tess::recognize(&rgba, w, h, lang);
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (rgba, w, h, lang);
        Err(Error::new(ErrorCode::Unsupported, "Text recognition isn't available on this system yet."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tsv_words_are_normalised_and_non_words_skipped() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
                   1\t1\t0\t0\t0\t0\t0\t0\t200\t100\t-1\t\n\
                   5\t1\t1\t1\t1\t1\t20\t10\t50\t20\t96.5\tHello\n\
                   5\t1\t1\t1\t1\t2\t80\t10\t60\t20\t91\t   \n\
                   5\t1\t1\t1\t1\t3\t150\t10\t40\t20\t90\twor ld\n";
        let w = parse_tsv(tsv, 200.0, 100.0);
        assert_eq!(w.len(), 2);
        assert_eq!(w[0], OcrWordN { text: "Hello".into(), x: 0.1, y: 0.1, width: 0.25, height: 0.2 });
        assert_eq!(w[1].text, "wor ld");
    }
}

/// Recognise one page off the UI thread and cache the result.
pub async fn ocr_page(core: &Arc<Core>, book_id: &str, page: u32, bytes: Vec<u8>, width: u32, height: u32, lang: Option<String>) -> Res<OcrPage> {
    core.db.get_book(book_id)?;
    let (words, tag) = tauri::async_runtime::spawn_blocking(move || recognize(&bytes, width, height, lang.as_deref()))
        .await
        .map_err(|e| Error::new(ErrorCode::Io, format!("Text recognition stopped unexpectedly ({e}).")))??;
    let p = OcrPage { page, lang: tag, words };
    core.db.ocr_store(book_id, &p)?;
    Ok(p)
}

// ---- commands (page bytes arrive through `raw.rs`) ---------------------------------------------

type C<'a> = State<'a, Arc<Core>>;

/// Installed OCR languages; the one OCR uses by default is flagged.
#[tauri::command]
#[specta::specta]
pub async fn ocr_languages() -> Res<Vec<OcrLanguage>> {
    tauri::async_runtime::spawn_blocking(languages).await.map_err(|e| Error::new(ErrorCode::Io, e.to_string()))?
}

/// Cached OCR for every page done so far (words normalised 0..1 to the page image).
#[tauri::command]
#[specta::specta]
pub async fn get_ocr_pages(core: C<'_>, book_id: String) -> Res<Vec<OcrPage>> {
    core.db.ocr_pages(&book_id)
}

#[tauri::command]
#[specta::specta]
pub async fn ocr_status(core: C<'_>, book_id: String) -> Res<OcrStatus> {
    core.db.ocr_status(&book_id)
}

/// Forget a book's OCR (to redo it in another language). Also drops its search index.
#[tauri::command]
#[specta::specta]
pub async fn clear_ocr(core: C<'_>, book_id: String) -> Res<()> {
    core.db.clear_ocr(&book_id)?;
    core.db.clear_index(&book_id)
}
