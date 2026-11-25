//! `quire://` custom scheme: serves allow-listed files with HTTP Range support.
//!
//! URL format (Windows / WebView2 rewrites custom schemes to http):
//!   `http://quire.localhost/file?path=<percent-encoded absolute path>`
//!   `http://quire.localhost/book/<id>`   (resolved through `resolve_book`, wired by T4)
//!
//! Tauri's responder takes a whole body, so we cannot stream a response; instead every
//! response is capped at `MAX_CHUNK` bytes and only the requested slice is read from disk
//! (seek + read_exact). Range clients (pdf.js, fetch) just ask again. A request without
//! `Range` for a big file gets 206 for the first chunk, which fetch() accepts.

use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

pub const SCHEME: &str = "quire";
/// Largest body returned for one request.
pub const MAX_CHUNK: u64 = 16 * 1024 * 1024;

/// Paths the webview may read. T4 backs this with the library DB.
#[derive(Default)]
pub struct AllowList(Mutex<HashSet<PathBuf>>);

impl AllowList {
    pub fn allow(&self, path: &Path) -> std::io::Result<()> {
        let canon = std::fs::canonicalize(path)?;
        self.0.lock().unwrap().insert(canon);
        Ok(())
    }
    pub fn is_allowed(&self, path: &Path) -> bool {
        std::fs::canonicalize(path).is_ok_and(|p| self.0.lock().unwrap().contains(&p))
    }
}

/// Resolves `/book/<id>` to a file path. T4 replaces the body.
pub fn resolve_book<R: Runtime>(_app: &tauri::AppHandle<R>, _id: &str) -> Option<PathBuf> {
    None
}

#[derive(Debug, PartialEq, Eq)]
pub enum RangeSel {
    /// No (or ignorable) Range header: whole file.
    Full,
    /// Inclusive byte range.
    Partial(u64, u64),
    Unsatisfiable,
}

/// Parse a single-range `Range: bytes=...` header against a file of `len` bytes.
/// Multi-range and malformed headers are ignored (served as full), per RFC 9110.
pub fn parse_range(header: Option<&str>, len: u64) -> RangeSel {
    let Some(spec) = header.and_then(|h| h.trim().strip_prefix("bytes=")) else {
        return RangeSel::Full;
    };
    if spec.contains(',') {
        return RangeSel::Full;
    }
    let Some((a, b)) = spec.split_once('-') else {
        return RangeSel::Full;
    };
    let (a, b) = (a.trim(), b.trim());
    if a.is_empty() {
        // suffix: last N bytes
        let Ok(n) = b.parse::<u64>() else { return RangeSel::Full };
        if n == 0 || len == 0 {
            return RangeSel::Unsatisfiable;
        }
        return RangeSel::Partial(len.saturating_sub(n), len - 1);
    }
    let Ok(start) = a.parse::<u64>() else { return RangeSel::Full };
    if start >= len {
        return RangeSel::Unsatisfiable;
    }
    let end = if b.is_empty() {
        len - 1
    } else {
        match b.parse::<u64>() {
            Ok(e) if e >= start => e.min(len - 1),
            _ => return RangeSel::Full,
        }
    };
    RangeSel::Partial(start, end)
}

fn sniff_mime(head: &[u8], path: &Path) -> String {
    let m = |s: &[u8]| head.starts_with(s);
    let sniffed = if m(b"%PDF") {
        Some("application/pdf")
    } else if m(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if m(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if m(b"GIF8") {
        Some("image/gif")
    } else if m(b"RIFF") && head.get(8..12) == Some(b"WEBP".as_slice()) {
        Some("image/webp")
    } else {
        None
    };
    match sniffed {
        Some(s) => s.to_string(),
        None => mime_guess::from_path(path).first_or_octet_stream().essence_str().to_string(),
    }
}

fn base(status: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range, If-Range")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Range, Content-Length, Accept-Ranges, Content-Type",
        )
        .header(header::ACCEPT_RANGES, "bytes")
}

fn err(status: StatusCode) -> Response<Vec<u8>> {
    base(status).body(Vec::new()).unwrap()
}

/// Serve `path` honouring `range`. `head_only` skips the body (HEAD).
pub fn serve_file(path: &Path, range: Option<&str>, head_only: bool) -> Response<Vec<u8>> {
    let Ok(mut f) = File::open(path) else { return err(StatusCode::NOT_FOUND) };
    let Ok(len) = f.metadata().map(|m| m.len()) else { return err(StatusCode::NOT_FOUND) };

    let (start, end, partial) = match parse_range(range, len) {
        RangeSel::Unsatisfiable => {
            return base(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .body(Vec::new())
                .unwrap();
        }
        RangeSel::Partial(s, e) => (s, e.min(s + MAX_CHUNK - 1), true),
        RangeSel::Full if len > MAX_CHUNK => (0, MAX_CHUNK - 1, true),
        RangeSel::Full => (0, len.saturating_sub(1), false),
    };
    let n = if len == 0 { 0 } else { end - start + 1 };

    let mut body = vec![0u8; if head_only { 0 } else { n as usize }];
    let mut head = [0u8; 16];
    if len > 0 {
        let _ = f.read(&mut head); // for type sniffing (always from byte 0)
        if !head_only && (f.seek(SeekFrom::Start(start)).is_err() || f.read_exact(&mut body).is_err()) {
            return err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    let mut b = base(if partial { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK })
        .header(header::CONTENT_TYPE, sniff_mime(&head, path))
        .header(header::CONTENT_LENGTH, n.to_string())
        .header(header::CACHE_CONTROL, "no-store");
    if partial {
        b = b.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
    }
    b.body(body).unwrap()
}

fn query_param(uri: &tauri::http::Uri, key: &str) -> Option<String> {
    uri.query()?.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned())
    })
}

fn handle<R: Runtime>(app: &tauri::AppHandle<R>, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if req.method() == Method::OPTIONS {
        return err(StatusCode::NO_CONTENT);
    }
    let head_only = req.method() == Method::HEAD;
    if !head_only && req.method() != Method::GET {
        return err(StatusCode::METHOD_NOT_ALLOWED);
    }
    let uri = req.uri();
    let path = match uri.path() {
        "/file" => query_param(uri, "path").map(PathBuf::from),
        p => p.strip_prefix("/book/").and_then(|id| resolve_book(app, id)),
    };
    let Some(path) = path else { return err(StatusCode::NOT_FOUND) };
    if !app.state::<AllowList>().is_allowed(&path) {
        return err(StatusCode::FORBIDDEN);
    }
    let range = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
    serve_file(&path, range, head_only)
}

/// Async handler so disk IO never blocks the UI thread.
pub fn handler<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    req: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    std::thread::spawn(move || responder.respond(handle(&app, &req)));
}
