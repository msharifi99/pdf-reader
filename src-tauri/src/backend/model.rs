//! Types crossing the IPC boundary. Timestamps are ms since epoch as f64 (specta forbids i64).
use serde::{Deserialize, Serialize};
use specta::Type;

/// Arbitrary JSON (locators, anchors, settings). `unknown` on the TS side; callers cast.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq)]
#[serde(transparent)]
pub struct Json(#[specta(type = specta_typescript::Unknown)] pub serde_json::Value);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Pdf,
    Epub,
    Mobi,
    Azw3,
    Fb2,
    Fbz,
    Cbz,
    Cbr,
    Image,
}
impl Format {
    pub fn as_str(&self) -> &'static str {
        match self {
            Format::Pdf => "pdf",
            Format::Epub => "epub",
            Format::Mobi => "mobi",
            Format::Azw3 => "azw3",
            Format::Fb2 => "fb2",
            Format::Fbz => "fbz",
            Format::Cbz => "cbz",
            Format::Cbr => "cbr",
            Format::Image => "image",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "pdf" => Format::Pdf,
            "epub" => Format::Epub,
            "mobi" => Format::Mobi,
            "azw3" => Format::Azw3,
            "fb2" => Format::Fb2,
            "fbz" => Format::Fbz,
            "cbz" => Format::Cbz,
            "cbr" => Format::Cbr,
            "image" => Format::Image,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Unread,
    Reading,
    Finished,
}
impl Status {
    pub fn as_str(&self) -> &'static str {
        match self {
            Status::Unread => "unread",
            Status::Reading => "reading",
            Status::Finished => "finished",
        }
    }
    pub fn parse(s: &str) -> Self {
        match s {
            "reading" => Status::Reading,
            "finished" => Status::Finished,
            _ => Status::Unread,
        }
    }
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub fingerprint: String,
    pub format: Format,
    pub title: String,
    pub author: String,
    /// `http://quire.localhost/cover/<id>?v=<rev>`; absent until a cover exists.
    pub cover_url: Option<String>,
    /// True when no cover is stored yet; the frontend should render one and call `save_cover`.
    pub needs_cover: bool,
    pub page_count: Option<i32>,
    pub word_count: Option<i32>,
    pub status: Status,
    #[specta(type = specta_typescript::Number)]
    pub added_at: f64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub last_opened_at: Option<f64>,
    #[specta(type = specta_typescript::Number)]
    pub file_size: f64,
    /// Per-book presentation settings (flow, spread, zoom, fit, rotation, tint, direction, typography, comic mode).
    pub settings: Json,
    /// At least one known path currently exists.
    pub available: bool,
    /// Best known path (available first). For image books this is the folder.
    pub path: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub progress: Option<f64>,
    /// Collection ids.
    pub collections: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub book_id: String,
    pub locator: Json,
    #[specta(type = specta_typescript::Number)]
    pub fraction: f64,
    #[specta(type = specta_typescript::Number)]
    pub updated_at: f64,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDocument {
    pub book: Book,
    pub progress: Option<Progress>,
    /// When a single image was opened: that image's absolute path (the book is its folder).
    pub start_image: Option<String>,
    /// The book was added by this open (not already in the library): if it then fails to open it is removed again.
    pub created: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SortKey {
    #[default]
    Recent,
    Added,
    Title,
    Author,
    Progress,
}

#[derive(Debug, Clone, Default, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct ListQuery {
    pub sort: SortKey,
    /// Flip the natural direction of `sort`.
    pub reverse: bool,
    pub formats: Vec<Format>,
    pub status: Option<Status>,
    pub collection: Option<String>,
    /// Matches title/author, every word must hit.
    pub text: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct MetadataPatch {
    pub title: Option<String>,
    pub author: Option<String>,
    pub page_count: Option<i32>,
    pub word_count: Option<i32>,
    /// True when the user typed these values: they then win over later automatic extraction.
    pub user: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub count: i32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationKind {
    Bookmark,
    Highlight,
    Note,
}
impl AnnotationKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Bookmark => "bookmark",
            Self::Highlight => "highlight",
            Self::Note => "note",
        }
    }
    pub fn parse(s: &str) -> Self {
        match s {
            "highlight" => Self::Highlight,
            "note" => Self::Note,
            _ => Self::Bookmark,
        }
    }
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub book_id: String,
    #[serde(rename = "type")]
    pub kind: AnnotationKind,
    pub color: Option<String>,
    pub anchor: Json,
    pub note: Option<String>,
    pub label: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub created_at: f64,
    #[specta(type = specta_typescript::Number)]
    pub updated_at: f64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub deleted_at: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewAnnotation {
    pub book_id: String,
    #[serde(rename = "type")]
    pub kind: AnnotationKind,
    pub color: Option<String>,
    pub anchor: Json,
    pub note: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AnnotationPatch {
    #[serde(rename = "type")]
    pub kind: Option<AnnotationKind>,
    pub color: Option<String>,
    pub anchor: Option<Json>,
    pub note: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationWithBook {
    pub annotation: Annotation,
    pub book_title: String,
    pub book_author: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReadingSpeed {
    #[specta(type = specta_typescript::Number)]
    pub words_per_minute: f64,
    #[specta(type = specta_typescript::Number)]
    pub minutes_per_page: f64,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TextHit {
    pub book_id: String,
    pub book_title: String,
    pub locator: Json,
    /// Snippet with `<mark>..</mark>` around matches; everything else is plain text.
    pub snippet: String,
}

pub fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}
