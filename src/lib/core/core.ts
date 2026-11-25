/**
 * The backend seam. `core` is the generated Tauri command set in the app and an in-memory
 * fake in a plain browser (Playwright, `npm run dev` in Chromium). Both are typed as `CoreApi`,
 * which is derived from the generated bindings, so the fake cannot drift from Rust.
 */
import type { Book, IndexControl, IndexProgress, OcrPage, commands } from './bindings';

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
  /** Any window wrote a setting: apply it here (the writer hears its own echo too, harmlessly). */
  onSettingsChanged(cb: (key: string, value: unknown) => void): Promise<Unlisten>;
  /** The window is closing: write everything pending, then call `core.flushDone()`. */
  onFlushRequest(cb: () => void): Promise<Unlisten>;
  /** Indexing progress: fires when a book starts/finishes indexing and when a failure is recorded. */
  onIndexProgress(cb: (p: IndexProgress) => void): Promise<Unlisten>;
  /** Core -> indexer window: `paused` while the user is reading. */
  onIndexControl(cb: (c: IndexControl) => void): Promise<Unlisten>;
}

/**
 * Commands whose payload is bytes. Sent as a raw binary request body (no JSON number arrays),
 * so a 12 MB page bitmap costs one copy. Same names in the fake core.
 */
export interface RawApi {
  /**
   * OCR one page. `pixels` is raw RGBA (`width*height*4` bytes) or an encoded PNG/JPEG/WebP.
   * Words come back with boxes normalised 0..1 to the page image and are cached by the core.
   * Rejects with `{ code, message }` (e.g. `Unsupported` when Windows has no OCR language).
   */
  ocrPage(req: { bookId: string; page: number; width: number; height: number; lang?: string | null }, pixels: Uint8Array): Promise<OcrPage>;
  /** Raw-bytes `saveCover`: WebP/JPEG/PNG bytes (empty = "can't make one"). */
  saveCover(bookId: string, bytes: Uint8Array): Promise<Book>;
}

/** A readable file: by absolute path (must be allowed) or by library book id. */
export type FileRef = { path: string } | { bookId: string };

export interface CoreRuntime {
  mode: 'tauri' | 'fake';
  api: CoreApi;
  raw: RawApi;
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
  onSettingsChanged: (cb) => current().events.onSettingsChanged(cb),
  onFlushRequest: (cb) => current().events.onFlushRequest(cb),
  onIndexProgress: (cb) => current().events.onIndexProgress(cb),
  onIndexControl: (cb) => current().events.onIndexControl(cb),
};

/** Binary-body commands: `await raw.ocrPage({ bookId, page, width, height }, rgba)`. */
export const raw: RawApi = {
  ocrPage: (req, pixels) => current().raw.ocrPage(req, pixels),
  saveCover: (id, bytes) => current().raw.saveCover(id, bytes),
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

async function thisWindow() {
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  return getCurrentWebviewWindow();
}

/** Pick the implementation. Call once from main.ts. */
export async function initCore(): Promise<CoreRuntime> {
  if (runtime) return runtime;
  if (isTauri()) {
    const { commands, events } = await import('./bindings');
    runtime = {
      mode: 'tauri',
      api: commands,
      events: {
        // window-scoped: with several windows, each hears only events addressed to it (or broadcast)
        onOpenFiles: async (cb) => events.openFiles(await thisWindow()).listen((e) => cb(e.payload)),
        onMaxButtonHover: async (cb) => events.maxButtonHover(await thisWindow()).listen((e) => cb(e.payload)),
        onLibraryChanged: (cb) => events.libraryChanged.listen((e) => cb(e.payload)),
        onIngestProgress: (cb) => events.ingestProgress.listen((e) => cb(e.payload)),
        onBackupRestored: (cb) => events.backupRestored.listen(() => cb()),
        onSettingsChanged: (cb) => events.settingsChanged.listen((e) => cb(e.payload.key, e.payload.value)),
        // window-scoped like the other per-window events
        onFlushRequest: async (cb) => events.flushRequest(await thisWindow()).listen(() => cb()),
        onIndexProgress: (cb) => events.indexProgress.listen((e) => cb(e.payload)),
        onIndexControl: (cb) => events.indexControl.listen((e) => cb(e.payload)),
      },
      raw: {
        // Raw body + `x-*` headers (see src-tauri/src/backend/raw.rs).
        ocrPage: async (r, pixels) => {
          const { invoke } = await import('@tauri-apps/api/core');
          const headers = { 'x-book-id': r.bookId, 'x-page': String(r.page), 'x-width': String(r.width), 'x-height': String(r.height), 'x-lang': r.lang ?? '' };
          return invoke<OcrPage>('ocr_page', pixels, { headers });
        },
        saveCover: async (id, bytes) => {
          const { invoke } = await import('@tauri-apps/api/core');
          return invoke<Book>('save_cover_raw', bytes, { headers: { 'x-book-id': id } });
        },
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
