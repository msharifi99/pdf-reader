mod commands;
pub mod protocol;
mod window;

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta_typescript::Typescript;
use tauri::{AppHandle, DragDropEvent, Manager, WindowEvent};
use tauri_specta::{collect_commands, collect_events, Builder, Event};

use commands::LaunchFiles;
use protocol::AllowList;

/// Files the user asked to open (second launch, drag-drop). Paths are already allow-listed.
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type, Event)]
pub struct OpenFiles(pub Vec<String>);

const BINDINGS_PATH: &str = "../src/lib/core/bindings.ts";

/// The one definition of commands + events. T4 and later tasks add to these lists.
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
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
        ])
        .events(collect_events![OpenFiles, window::MaxButtonHover])
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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, protocol::handler)
        .manage(AllowList::default())
        .manage(window::Backdrop::default())
        .manage(LaunchFiles::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            let handle = app.handle();
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
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                let paths = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                open_files(win.app_handle(), paths);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Quire");
}
