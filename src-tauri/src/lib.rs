pub mod backend;
pub mod dictionary;
mod commands;
pub mod protocol;
mod window;

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta_typescript::Typescript;
use tauri::{AppHandle, DragDropEvent, Manager, WindowEvent};
use tauri_specta::{collect_commands, collect_events, Builder, Event};

use backend::{commands as bc, index, ocr, BackupRestored, Core, CoreEvent, IndexControl, IndexProgress, IngestProgress, LibraryChanged};
use commands::LaunchFiles;
use protocol::AllowList;

/// Files the user asked to open (second launch, drag-drop). Paths are already allow-listed.
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type, Event)]
pub struct OpenFiles(pub Vec<String>);

const BINDINGS_PATH: &str = "../src/lib/core/bindings.ts";

/// The one definition of commands + events. T4 and later tasks add to these lists.
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .disable_serde_phases()
        .commands(collect_commands![
            commands::app_version,
            commands::take_launch_files,
            commands::allow_path,
            commands::window_backdrop,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close,
            commands::window_toggle_fullscreen,
            commands::window_start_drag,
            commands::window_set_maxbtn_rect,
            bc::open_document,
            bc::list_books,
            bc::get_book,
            bc::continue_reading,
            bc::remove_book,
            bc::set_book_status,
            bc::set_book_settings,
            bc::set_book_metadata,
            bc::save_cover,
            bc::cover_url,
            bc::books_needing_covers,
            bc::reveal_in_explorer,
            bc::list_image_folder,
            bc::list_collections,
            bc::create_collection,
            bc::rename_collection,
            bc::delete_collection,
            bc::add_to_collection,
            bc::remove_from_collection,
            bc::save_progress,
            bc::get_progress,
            bc::start_session,
            bc::end_session,
            bc::reading_speed,
            bc::create_annotation,
            bc::update_annotation,
            bc::delete_annotation,
            bc::restore_annotation,
            bc::list_annotations,
            bc::list_all_annotations,
            bc::get_setting,
            bc::set_setting,
            bc::get_all_settings,
            bc::list_watched_folders,
            bc::add_watched_folder,
            bc::remove_watched_folder,
            bc::rescan_watched_folders,
            bc::list_system_fonts,
            bc::search_library_text,
            dictionary::lookup_word,
            dictionary::suggest_words,
            bc::backup,
            bc::restore,
            index::index_book_chunks,
            index::index_status,
            index::books_needing_index,
            index::mark_index_failed,
            index::clear_index,
            index::set_reading_active,
            ocr::ocr_languages,
            ocr::get_ocr_pages,
            ocr::ocr_status,
            ocr::clear_ocr,
        ])
        .events(collect_events![OpenFiles, window::MaxButtonHover, LibraryChanged, IngestProgress, BackupRestored, IndexProgress, IndexControl])
}

pub fn export_bindings(builder: &Builder<tauri::Wry>) {
    builder
        .export(Typescript::default(), BINDINGS_PATH)
        .expect("failed to export typescript bindings");
}

/// Allow-list `paths` and tell the frontend to open them.
fn open_files(app: &AppHandle, paths: Vec<String>) {
    let allow = app.state::<AllowList>();
    let paths: Vec<String> = paths.into_iter().filter(|p| allow.allow(Path::new(p)).is_ok()).collect();
    if !paths.is_empty() {
        let _ = OpenFiles(paths).emit(app);
    }
}

/// File arguments from an argv (skipping argv[0]).
fn file_args(argv: &[String]) -> Vec<String> {
    argv.iter().skip(1).filter(|a| Path::new(a).is_file()).cloned().collect()
}

pub fn run() {
    let builder = specta_builder();
    #[cfg(debug_assertions)]
    export_bindings(&builder);

    let launch: Vec<String> = file_args(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            open_files(app, file_args(&argv));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().with_denylist(&["indexer"]).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, protocol::handler)
        .manage(AllowList::default())
        .manage(window::Backdrop::default())
        .manage(LaunchFiles::default())
        .invoke_handler(backend::raw::handler(builder.invoke_handler()))
        .setup(move |app| {
            builder.mount_events(app);
            let handle = app.handle();
            app.manage(dictionary::Dictionary::new(dictionary_path(handle)));
            #[cfg(debug_assertions)]
            {
                let t = std::time::Instant::now();
                let r = app.state::<dictionary::Dictionary>().lookup("running");
                eprintln!("[dictionary] self-test \"running\" -> {:?} in {:?}", r.ok().flatten().map(|d| d.lemma), t.elapsed());
            }
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            let h = handle.clone();
            let emit: backend::Emitter = std::sync::Arc::new(move |e| {
                let _ = match e {
                    CoreEvent::LibraryChanged(ids) => LibraryChanged(ids).emit(&h),
                    CoreEvent::IngestProgress { done, total } => IngestProgress { done, total }.emit(&h),
                    CoreEvent::BackupRestored => BackupRestored(true).emit(&h),
                    CoreEvent::IndexProgress { done, total, failed, current } => IndexProgress { done, total, failed, current }.emit(&h),
                    CoreEvent::IndexControl { paused } => IndexControl { paused }.emit(&h),
                };
            });
            let core = std::sync::Arc::new(Core::new(&data_dir, emit).expect("couldn't open the library database"));
            core.start();
            index::schedule_indexer(handle.clone(), core.clone(), std::time::Duration::from_secs(4));
            app.manage(core);
            {
                // Launch files are allow-listed now; the frontend collects them via take_launch_files.
                let allow = app.state::<AllowList>();
                let ok: Vec<String> = launch.iter().filter(|p| allow.allow(Path::new(p)).is_ok()).cloned().collect();
                *app.state::<LaunchFiles>().0.lock().unwrap() = ok;
            }
            if let Some(w) = app.get_webview_window("main") {
                window::setup(handle, &w);
            }
            Ok(())
        })
        .on_window_event(|win, event| {
            // The hidden indexer must not keep the app alive after the main window closes.
            if win.label() == "main" && matches!(event, WindowEvent::CloseRequested { .. }) {
                if let Some(w) = win.app_handle().get_webview_window("indexer") {
                    let _ = w.destroy();
                }
            }
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                let paths = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                open_files(win.app_handle(), paths);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Quire");
}

/// The bundled dictionary: the Tauri resource dir when installed, the source tree in dev.
fn dictionary_path(app: &AppHandle) -> std::path::PathBuf {
    use tauri::path::BaseDirectory;
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/dictionary.sqlite");
    let p = app.path().resolve("resources/dictionary.sqlite", BaseDirectory::Resource).ok().filter(|p| p.exists()).unwrap_or(dev);
    eprintln!("[dictionary] using {}", p.display());
    p
}
