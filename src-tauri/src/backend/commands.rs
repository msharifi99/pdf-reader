//! Thin `#[tauri::command]` wrappers. Async so SQLite and disk work never run on the UI thread.

use std::path::Path;
use std::sync::Arc;
use std::collections::HashMap;

use tauri::State;

use super::error::{Error, ErrorCode, Res};
use super::model::*;
use super::{files, fonts, Core};

type C<'a> = State<'a, Arc<Core>>;

// ---- documents and library ----------------------------------------------------------------

/// Add (or re-link) the file/folder/image to the library and return it with its saved progress.
/// A folder opens as a book over its images; a single image opens its folder, `startImage` set.
#[tauri::command]
#[specta::specta]
pub async fn open_document(core: C<'_>, path: String) -> Res<OpenedDocument> {
    core.open_document(&path)
}

#[tauri::command]
#[specta::specta]
pub async fn list_books(core: C<'_>, query: ListQuery) -> Res<Vec<Book>> {
    core.db.list_books(&query)
}

#[tauri::command]
#[specta::specta]
pub async fn get_book(core: C<'_>, id: String) -> Res<Book> {
    core.db.get_book(&id)
}

#[tauri::command]
#[specta::specta]
pub async fn continue_reading(core: C<'_>, limit: u32) -> Res<Vec<Book>> {
    core.db.continue_reading(limit)
}

/// Hides the book from the library; never touches the file.
#[tauri::command]
#[specta::specta]
pub async fn remove_book(core: C<'_>, id: String) -> Res<()> {
    core.db.remove_book(&id)
}

#[tauri::command]
#[specta::specta]
pub async fn set_book_status(core: C<'_>, id: String, status: Status) -> Res<()> {
    core.db.set_book_status(&id, status)
}

/// Shallow-merge `patch` into the book's presentation settings (`null` removes a key). Returns the result.
#[tauri::command]
#[specta::specta]
pub async fn set_book_settings(core: C<'_>, id: String, patch: Json) -> Res<Json> {
    core.db.set_book_settings(&id, &patch.0).map(Json)
}

#[tauri::command]
#[specta::specta]
pub async fn set_book_metadata(core: C<'_>, id: String, patch: MetadataPatch) -> Res<Book> {
    core.db.set_book_metadata(&id, &patch)
}

/// Store a cover image (WebP from the frontend). Empty bytes = "can't make one", stops re-asking.
#[tauri::command]
#[specta::specta]
pub async fn save_cover(core: C<'_>, id: String, bytes: Vec<u8>) -> Res<Book> {
    let ext = if bytes.starts_with(&[0xff, 0xd8]) { "jpg" } else if bytes.starts_with(&[0x89, b'P']) { "png" } else { "webp" };
    core.db.save_cover(&id, &bytes, ext)?;
    core.db.get_book(&id)
}

#[tauri::command]
#[specta::specta]
pub async fn cover_url(core: C<'_>, id: String) -> Res<Option<String>> {
    Ok(core.db.get_book(&id)?.cover_url)
}

/// Books with no cover yet whose file is available: render page 1 / first image and `save_cover`.
#[tauri::command]
#[specta::specta]
pub async fn books_needing_covers(core: C<'_>) -> Res<Vec<Book>> {
    core.db.books_needing_covers()
}

#[tauri::command]
#[specta::specta]
pub async fn reveal_in_explorer(core: C<'_>, id: String) -> Res<()> {
    let book = core.db.get_book(&id)?;
    let path = book.path.ok_or_else(|| Error::not_found("that file"))?;
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| Error::new(ErrorCode::Io, format!("Couldn't open Explorer ({e}).")))
}

/// Naturally sorted image files in `path` (or in the folder containing `path` if it is a file).
#[tauri::command]
#[specta::specta]
pub async fn list_image_folder(path: String) -> Res<Vec<String>> {
    let p = Path::new(&path);
    let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
    Ok(files::list_image_folder(dir)?.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

// ---- collections --------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub async fn list_collections(core: C<'_>) -> Res<Vec<Collection>> {
    core.db.list_collections()
}
#[tauri::command]
#[specta::specta]
pub async fn create_collection(core: C<'_>, name: String) -> Res<Collection> {
    core.db.create_collection(&name)
}
#[tauri::command]
#[specta::specta]
pub async fn rename_collection(core: C<'_>, id: String, name: String) -> Res<()> {
    core.db.rename_collection(&id, &name)
}
#[tauri::command]
#[specta::specta]
pub async fn delete_collection(core: C<'_>, id: String) -> Res<()> {
    core.db.delete_collection(&id)
}
#[tauri::command]
#[specta::specta]
pub async fn add_to_collection(core: C<'_>, book_id: String, collection_id: String) -> Res<()> {
    core.db.add_to_collection(&book_id, &collection_id)
}
#[tauri::command]
#[specta::specta]
pub async fn remove_from_collection(core: C<'_>, book_id: String, collection_id: String) -> Res<()> {
    core.db.remove_from_collection(&book_id, &collection_id)
}

// ---- progress and sessions ----------------------------------------------------------------

/// Cheap upsert; also moves the book to reading/finished (>= 99.5%). The UI debounces to 2 s.
#[tauri::command]
#[specta::specta]
pub async fn save_progress(core: C<'_>, book_id: String, locator: Json, fraction: f64) -> Res<()> {
    core.db.save_progress(&book_id, &locator.0, fraction)
}
#[tauri::command]
#[specta::specta]
pub async fn get_progress(core: C<'_>, book_id: String) -> Res<Option<Progress>> {
    core.db.get_progress(&book_id)
}
#[tauri::command]
#[specta::specta]
pub async fn start_session(core: C<'_>, book_id: String) -> Res<i32> {
    core.db.start_session(&book_id)
}
/// `unit`: "words" or "pages".
#[tauri::command]
#[specta::specta]
pub async fn end_session(core: C<'_>, session_id: i32, amount: f64, unit: String) -> Res<()> {
    core.db.end_session(session_id, amount, &unit)
}
#[tauri::command]
#[specta::specta]
pub async fn reading_speed(core: C<'_>, book_id: Option<String>) -> Res<ReadingSpeed> {
    core.db.reading_speed(book_id.as_deref())
}

// ---- annotations --------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub async fn create_annotation(core: C<'_>, annotation: NewAnnotation) -> Res<Annotation> {
    core.db.create_annotation(&annotation)
}
#[tauri::command]
#[specta::specta]
pub async fn update_annotation(core: C<'_>, id: String, patch: AnnotationPatch) -> Res<Annotation> {
    core.db.update_annotation(&id, &patch)
}
/// Soft delete: `restore_annotation` brings it back (undo).
#[tauri::command]
#[specta::specta]
pub async fn delete_annotation(core: C<'_>, id: String) -> Res<()> {
    core.db.delete_annotation(&id)
}
#[tauri::command]
#[specta::specta]
pub async fn restore_annotation(core: C<'_>, id: String) -> Res<Annotation> {
    core.db.restore_annotation(&id)
}
/// Live annotations of a book, ordered by position.
#[tauri::command]
#[specta::specta]
pub async fn list_annotations(core: C<'_>, book_id: String) -> Res<Vec<Annotation>> {
    core.db.list_annotations(&book_id)
}
#[tauri::command]
#[specta::specta]
pub async fn list_all_annotations(core: C<'_>, query: Option<String>) -> Res<Vec<AnnotationWithBook>> {
    core.db.list_all_annotations(query.as_deref())
}

// ---- settings, folders, fonts, search, backup ---------------------------------------------

#[tauri::command]
#[specta::specta]
pub async fn get_setting(core: C<'_>, key: String) -> Res<Option<Json>> {
    Ok(core.db.get_setting(&key)?.map(Json))
}
/// `null` deletes the key.
#[tauri::command]
#[specta::specta]
pub async fn set_setting(core: C<'_>, key: String, value: Json) -> Res<()> {
    core.db.set_setting(&key, &value.0)
}
#[tauri::command]
#[specta::specta]
pub async fn get_all_settings(core: C<'_>) -> Res<HashMap<String, Json>> {
    core.db.get_all_settings()
}

#[tauri::command]
#[specta::specta]
pub async fn list_watched_folders(core: C<'_>) -> Res<Vec<String>> {
    core.db.list_watched_folders()
}
#[tauri::command]
#[specta::specta]
pub async fn add_watched_folder(core: C<'_>, path: String) -> Res<()> {
    core.add_watched_folder(&path)
}
#[tauri::command]
#[specta::specta]
pub async fn remove_watched_folder(core: C<'_>, path: String) -> Res<()> {
    core.remove_watched_folder(&path)
}
#[tauri::command]
#[specta::specta]
pub async fn rescan_watched_folders(core: C<'_>) -> Res<()> {
    core.rescan_watched_folders();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn list_system_fonts() -> Vec<String> {
    fonts::list_system_fonts()
}

#[tauri::command]
#[specta::specta]
pub async fn search_library_text(core: C<'_>, query: String, limit: u32) -> Res<Vec<TextHit>> {
    core.db.search_library_text(&query, limit)
}

#[tauri::command]
#[specta::specta]
pub async fn backup(core: C<'_>, dest_path: String) -> Res<()> {
    core.db.backup(Path::new(&dest_path))
}
/// Replaces library data from a `.quire-backup`; emits `backup-restored` (reload the UI).
#[tauri::command]
#[specta::specta]
pub async fn restore(core: C<'_>, src_path: String) -> Res<()> {
    core.restore(Path::new(&src_path))
}
