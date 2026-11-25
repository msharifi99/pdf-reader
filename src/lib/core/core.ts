/**
 * The backend seam. `core` is the generated Tauri command set in the app and an in-memory
 * fake in a plain browser (Playwright, `npm run dev` in Chromium). Both are typed as `CoreApi`,
 * which is derived from the generated bindings, so the fake cannot drift from Rust.
 */
import type { commands } from './bindings';

export type CoreApi = typeof commands;

export type Unlisten = () => void;

/** Backend -> UI events. Real: Tauri events. Fake: in-memory emitter. */
export interface CoreEvents {
  /** Files to open (second launch, drag-drop). Paths are already allowed for `fileUrl`. */
  onOpenFiles(cb: (paths: string[]) => void): Promise<Unlisten>;
  /** Cursor entered/left the native maximize hit area (snap layouts); the webview can't see it. */
  onMaxButtonHover(cb: (hover: boolean) => void): Promise<Unlisten>;
  /** Books were added, re-linked or changed availability (ids). Re-query the library. */
  onLibraryChanged(cb: (bookIds: string[]) => void): Promise<Unlisten>;
  /** Watched-folder scan progress. */
  onIngestProgress(cb: (p: { done: number; total: number }) => void): Promise<Unlisten>;
  /** `restore` replaced the database: reload everything. */
  onBackupRestored(cb: () => void): Promise<Unlisten>;
}

/** A readable file: by absolute path (must be allowed) or by library book id. */
export type FileRef = { path: string } | { bookId: string };

export interface CoreRuntime {
  mode: 'tauri' | 'fake';
  api: CoreApi;
  events: CoreEvents;
  /** Range-capable URL for pdf.js / fetch / <img>. */
  fileUrl(ref: FileRef): string;
}

let runtime: CoreRuntime | undefined;

function current(): CoreRuntime {
  if (!runtime) throw new Error('core not initialised: await initCore() before mounting');
  return runtime;
}

/** Usage: `await core.appVersion()`. */
export const core: CoreApi = new Proxy({} as CoreApi, {
  get: (_t, key) => Reflect.get(current().api, key),
});

export const coreEvents: CoreEvents = {
  onOpenFiles: (cb) => current().events.onOpenFiles(cb),
  onMaxButtonHover: (cb) => current().events.onMaxButtonHover(cb),
  onLibraryChanged: (cb) => current().events.onLibraryChanged(cb),
  onIngestProgress: (cb) => current().events.onIngestProgress(cb),
  onBackupRestored: (cb) => current().events.onBackupRestored(cb),
};

/**
 * URL for a document.
 * Tauri/Windows: `http://quire.localhost/file?path=<encoded>` or `/book/<id>`
 * (WebView2 serves the `quire` scheme as http://quire.localhost). Fake: `/fixtures/<name>`.
 */
export function fileUrl(ref: FileRef): string {
  return current().fileUrl(ref);
}

/** Cover URL for a book id (`Book.coverUrl` is already set on every Book; use this when you only have an id). */
export function coverUrl(bookId: string, rev = 0): string {
  return current().mode === 'tauri' ? `http://quire.localhost/cover/${encodeURIComponent(bookId)}?v=${rev}` : `/fixtures/covers/${bookId}.webp`;
}

export function coreMode(): 'tauri' | 'fake' {
  return current().mode;
}

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Pick the implementation. Call once from main.ts. */
export async function initCore(): Promise<CoreRuntime> {
  if (runtime) return runtime;
  if (isTauri()) {
    const { commands, events } = await import('./bindings');
    runtime = {
      mode: 'tauri',
      api: commands,
      events: {
        onOpenFiles: (cb) => events.openFiles.listen((e) => cb(e.payload)),
        onMaxButtonHover: (cb) => events.maxButtonHover.listen((e) => cb(e.payload)),
        onLibraryChanged: (cb) => events.libraryChanged.listen((e) => cb(e.payload)),
        onIngestProgress: (cb) => events.ingestProgress.listen((e) => cb(e.payload)),
        onBackupRestored: (cb) => events.backupRestored.listen(() => cb()),
      },
      fileUrl: (ref) =>
        'path' in ref
          ? `http://quire.localhost/file?path=${encodeURIComponent(ref.path)}`
          : `http://quire.localhost/book/${encodeURIComponent(ref.bookId)}`,
    };
  } else {
    runtime = (await import('./fake-core')).createFakeRuntime();
  }
  return runtime;
}
