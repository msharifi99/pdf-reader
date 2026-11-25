//! Commands whose payload is raw bytes. tauri-specta can only type JSON arguments (a `Vec<u8>`
//! becomes a number array), so these bypass it: the body is the bytes, small metadata travels in
//! `x-*` headers. TypeScript wrappers live in `src/lib/core/core.ts` (`raw.ocrPage`, `raw.saveCover`); `save_book_file` is called from `src/lib/reader/session.svelte.ts`.

use std::sync::Arc;

use tauri::ipc::{Invoke, InvokeBody, Request};
use tauri::{Runtime, State};

use super::error::{Error, Res};
use super::model::Book;
use super::ocr::{self, OcrPage};
use super::Core;

fn header<'a>(r: &'a Request, k: &str) -> Option<&'a str> {
    r.headers().get(k)?.to_str().ok()
}

fn body<'a>(r: &'a Request) -> Res<&'a [u8]> {
    match r.body() {
        InvokeBody::Raw(b) => Ok(b),
        _ => Err(Error::invalid("Expected raw bytes.")),
    }
}

fn num(r: &Request, k: &str) -> Res<u32> {
    header(r, k).and_then(|v| v.parse().ok()).ok_or_else(|| Error::invalid(format!("Missing {k}.")))
}

/// Body = page pixels, raw RGBA (`width*height*4` bytes) or an encoded PNG/JPEG/WebP.
/// Headers: `x-book-id`, `x-page`, `x-width`, `x-height`, optional `x-lang`.
#[tauri::command]
pub async fn ocr_page(core: State<'_, Arc<Core>>, request: Request<'_>) -> Res<OcrPage> {
    let book = header(&request, "x-book-id").ok_or_else(|| Error::invalid("Missing x-book-id."))?.to_string();
    let lang = header(&request, "x-lang").filter(|l| !l.is_empty()).map(str::to_string);
    let (page, w, h) = (num(&request, "x-page")?, num(&request, "x-width")?, num(&request, "x-height")?);
    let bytes = body(&request)?.to_vec();
    ocr::ocr_page(&core, &book, page, bytes, w, h, lang).await
}

/// Body = cover image bytes (WebP/JPEG/PNG; empty = "can't make one"). Header: `x-book-id`.
#[tauri::command]
pub async fn save_cover_raw(core: State<'_, Arc<Core>>, request: Request<'_>) -> Res<Book> {
    let id = header(&request, "x-book-id").ok_or_else(|| Error::invalid("Missing x-book-id."))?.to_string();
    let bytes = body(&request)?;
    super::commands::store_cover(&core, &id, bytes)
}

/// Body = the whole PDF, form values filled in. Header: `x-book-id`. Replaces the book's file on disk.
#[tauri::command]
pub async fn save_book_file(core: State<'_, Arc<Core>>, request: Request<'_>) -> Res<Book> {
    let id = header(&request, "x-book-id").ok_or_else(|| Error::invalid("Missing x-book-id."))?.to_string();
    core.db.rewrite_book_file(&id, body(&request)?)
}

/// The invoke handler: raw commands here, everything else through the specta-generated one.
pub fn handler<R: Runtime>(typed: impl Fn(Invoke<R>) -> bool + Send + Sync + 'static) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    let raw: Box<dyn Fn(Invoke<R>) -> bool + Send + Sync> = Box::new(tauri::generate_handler![ocr_page, save_cover_raw, save_book_file]);
    move |inv| match inv.message.command() {
        "ocr_page" | "save_cover_raw" | "save_book_file" => raw(inv),
        _ => typed(inv),
    }
}
