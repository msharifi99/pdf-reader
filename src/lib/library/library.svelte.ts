/**
 * Library state and actions (T7). Commands, the Ctrl+P book switcher and the cover pass are
 * installed once at boot by `installLibrary()` (LibraryView's module script calls it), so they
 * keep working from the reader and from Settings.
 *
 *   lib.books / lib.continuing / lib.collections   reactive, re-queried on `library-changed`
 *   lib.query                                       text / formats / status / collection filters
 *   openLibraryBook(book, { locator?, newWindow? }) never throws; unavailable books get the calm error
 *   searchContents(q)                               full-text hits grouped by book (story 32)
 */
import type { Book, Collection, Format, ReadingSpeed, Status } from '../core/bindings';
import { core, coreEvents, coreMode, isTauri } from '../core/core';
import { commands, defineCommand, rankItems } from '../commands';
import type { Locator } from '../engines/types';
import { app, openDocument } from '../stores/app.svelte';
import { settings } from '../stores/settings.svelte';
import { presentError, reportError, ShellError } from '../shell/errors.svelte';
import { overlays } from '../shell/overlays.svelte';
import { openPalette, registerPaletteProvider } from '../shell/palette/providers.svelte';
import { toast } from '../ui';
import { librarySearch, type BookHits } from '../indexing/search';
import { startCoverPass } from './covers';
import { coverHue, percent } from './format';

export type LibraryView = 'grid' | 'list';

export const lib = $state({
  books: [] as Book[],
  continuing: [] as Book[],
  collections: [] as Collection[],
  loaded: false,
  query: { text: '', formats: [] as Format[], status: null as Status | null, collection: null as string | null },
  /** the book with the roving focus (grid/list keyboard navigation, F2, Delete...) */
  selId: null as string | null,
  /** books removed but still undoable: hidden here, committed to the core after the toast */
  pending: [] as string[],
  speed: null as ReadingSpeed | null,
  ingest: null as { done: number; total: number } | null,
  folders: [] as string[],
  /** dialogs owned by LibraryView */
  editing: null as Book | null,
  collectionDialog: null as { bookId?: string; rename?: Collection } | null,
});

export const visibleBooks = (): Book[] => (lib.pending.length ? lib.books.filter((b) => !lib.pending.includes(b.id)) : lib.books);
export const filtersActive = (): boolean => !!(lib.query.formats.length || lib.query.status || lib.query.collection);
export const selectedBook = (): Book | undefined => lib.books.find((b) => b.id === lib.selId);

// ---- loading ---------------------------------------------------------------------------------

let seq = 0;
export async function reload(): Promise<void> {
  const mine = ++seq;
  const q = lib.query;
  const p = settings.value.library;
  try {
    const [books, continuing, collections] = await Promise.all([
      core.listBooks({ sort: p.sort, reverse: p.reverse, formats: q.formats.length ? [...q.formats] : undefined, status: q.status, collection: q.collection, text: q.text.trim() || null }),
      core.continueReading(3),
      core.listCollections(),
    ]);
    if (mine !== seq) return;
    lib.books = books;
    lib.continuing = continuing.filter((b) => !lib.pending.includes(b.id));
    lib.collections = collections;
    if (q.collection && !collections.some((c) => c.id === q.collection)) lib.query.collection = null;
    lib.loaded = true;
  } catch (err) {
    if (mine === seq) reportError(err, 'Couldn’t load your library.');
  }
}

let reloadTimer: ReturnType<typeof setTimeout> | undefined;
/** Coalesce bursts (a folder scan announces many books). */
export function scheduleReload(ms = 80): void {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => void reload(), ms);
}

export async function loadFolders(): Promise<void> {
  lib.folders = await core.listWatchedFolders();
}

/** A fresh cover arrived: swap it into what is shown without a full re-query. */
function coverSaved(b: Book) {
  for (const list of [lib.books, lib.continuing]) {
    const i = list.findIndex((x) => x.id === b.id);
    if (i >= 0) list[i] = { ...list[i]!, coverUrl: b.coverUrl, needsCover: b.needsCover };
  }
}

/** Kick the background cover pass (idempotent). */
export const startCoverPassNow = (): void => startCoverPass(coverSaved);

// ---- actions ---------------------------------------------------------------------------------

/** Open a library book (in this window for now). Never throws. */
export async function openLibraryBook(book: Book, opts: { locator?: Locator; newWindow?: boolean } = {}): Promise<boolean> {
  if (!book.available || !book.path) {
    presentError(new ShellError('not-found'), { fileName: book.title });
    return false;
  }
  // TODO(T14): opts.newWindow should open a second window (story 121); it opens here until multi-window exists.
  return openDocument(book.path, { locator: opts.locator });
}

async function findBook(id: string): Promise<Book | undefined> {
  return lib.books.find((b) => b.id === id) ?? lib.continuing.find((b) => b.id === id) ?? (await core.getBook(id).catch(() => undefined));
}

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function commitRemoval(id: string) {
  clearTimeout(pendingTimers.get(id));
  pendingTimers.delete(id);
  try {
    await core.removeBook(id);
  } catch (err) {
    reportError(err, 'Couldn’t remove that book.');
  }
  lib.pending = lib.pending.filter((x) => x !== id);
  await reload();
}

/** Hide now, remove for real once the undo window has passed. The file on disk is never touched. */
export function removeBook(book: Book): void {
  if (lib.pending.includes(book.id)) return;
  const list = visibleBooks();
  const i = list.findIndex((b) => b.id === book.id);
  if (lib.selId === book.id) lib.selId = (list[i + 1] ?? list[i - 1])?.id ?? null;
  lib.pending = [...lib.pending, book.id];
  lib.continuing = lib.continuing.filter((b) => b.id !== book.id);
  pendingTimers.set(book.id, setTimeout(() => void commitRemoval(book.id), 7000));
  toast(`Removed “${book.title}” from your library`, {
    duration: 6500,
    action: {
      label: 'Undo',
      run: () => {
        if (pendingTimers.has(book.id)) {
          clearTimeout(pendingTimers.get(book.id));
          pendingTimers.delete(book.id);
          lib.pending = lib.pending.filter((x) => x !== book.id);
          lib.selId = book.id;
          void reload();
        } else if (book.path) {
          // already committed: the core restores a hidden book when its file is opened again
          void core.openDocument(book.path).then(() => reload(), (err) => reportError(err, 'Couldn’t bring that book back.'));
        }
      },
    },
  });
}

export async function setStatus(book: Book, status: Status): Promise<void> {
  await core.setBookStatus(book.id, status);
  await reload();
}

export async function toggleCollection(bookId: string, collectionId: string): Promise<void> {
  const b = await findBook(bookId);
  if (!b) return;
  if (b.collections.includes(collectionId)) await core.removeFromCollection(bookId, collectionId);
  else await core.addToCollection(bookId, collectionId);
  await reload();
}

export function setPrefs(p: Partial<typeof settings.value.library>): void {
  settings.set('library', { ...settings.value.library, ...p });
}

// ---- full-text search (story 32) --------------------------------------------------------------

/** Full-text hits for one book (T12's `librarySearch` groups), with the library entry for cover and author. */
export interface ContentGroup extends BookHits {
  book?: Book;
}

/**
 * Full-text hits across the library grouped by book, best book first, at most 3 passages per book.
 * Resolves `null` when a newer search superseded this one (ignore it).
 */
export async function searchContents(query: string, limit = 60): Promise<ContentGroup[] | null> {
  const groups = await librarySearch(query, { limit });
  if (!groups) return null;
  const list: ContentGroup[] = groups.map((g) => ({ ...g, hits: g.hits.slice(0, 3) }));
  await Promise.all(list.map(async (g) => (g.book = await findBook(g.bookId))));
  return list;
}

export async function openHit(bookId: string, locator: unknown): Promise<void> {
  const b = await findBook(bookId);
  if (b) await openLibraryBook(b, { locator: locator as Locator });
}

// ---- file pickers ----------------------------------------------------------------------------

/**
 * Native folder / open / save pickers. In the browser (fake core) there is no dialog plugin:
 * tests queue answers in `globalThis.__QUIRE_PICK__` (an array of paths; empty = cancelled).
 */
export async function pickPath(kind: 'folder' | 'open' | 'save', title: string): Promise<string | null> {
  if (!isTauri()) {
    const q = (globalThis as { __QUIRE_PICK__?: string[] }).__QUIRE_PICK__;
    return q?.shift() ?? null;
  }
  const d = await import('@tauri-apps/plugin-dialog');
  const filters = [{ name: 'Quire backup', extensions: ['quire-backup'] }];
  const r =
    kind === 'folder'
      ? await d.open({ directory: true, title })
      : kind === 'open'
        ? await d.open({ title, filters })
        : await d.save({ title, filters, defaultPath: `Quire ${new Date().toISOString().slice(0, 10)}.quire-backup` });
  return typeof r === 'string' ? r : null;
}

export async function addWatchedFolder(): Promise<boolean> {
  const path = await pickPath('folder', 'Choose a folder for Quire to watch');
  if (!path) return false;
  await core.addWatchedFolder(path);
  await loadFolders();
  void core.rescanWatchedFolders();
  return true;
}

// ---- commands, palette, events: installed once -------------------------------------------------

/** Book the keyboard/menu target means: explicit arg, else the focused tile, else the selection. */
async function target(args: unknown): Promise<Book | undefined> {
  const id = (args as { bookId?: string } | undefined)?.bookId ?? lib.selId;
  return id ? findBook(id) : undefined;
}

/** Shelf navigation, provided by the mounted Shelf. */
export interface ShelfNav {
  move(dx: number, dy: number): void;
  edge(end: boolean): void;
  focusSelected(): void;
  /** focus is inside the shelf, or nowhere in particular */
  owns(): boolean;
}
let shelf: ShelfNav | null = null;
export function provideShelf(nav: ShelfNav | null): void {
  shelf = nav;
}
let searchInput: HTMLInputElement | undefined;
export function provideSearch(el: HTMLInputElement | undefined): void {
  searchInput = el;
}

let installed = false;
export function installLibrary(): void {
  if (installed) return;
  installed = true;
  const inLibrary = () => app.view === 'library';
  const navigable = () => inLibrary() && !overlays.any && !!shelf?.owns();
  const withBook = (fn: (b: Book, args: unknown) => unknown) => async (args?: unknown) => {
    const b = await target(args);
    if (b) await fn(b, args);
  };

  commands.register([
    defineCommand('app.switchBook', () => openPalette({ mode: 'books' })),
    // TODO(T14): a real second window. Until then this opens the book here.
    defineCommand('app.newWindow', withBook((b) => openLibraryBook(b, { newWindow: true }))),
    defineCommand('library.open', withBook((b) => openLibraryBook(b)), inLibrary),
    defineCommand('library.openInNewWindow', withBook((b) => commands.execute('app.newWindow', { bookId: b.id })), inLibrary),
    defineCommand('library.moveLeft', () => shelf?.move(-1, 0), navigable),
    defineCommand('library.moveRight', () => shelf?.move(1, 0), navigable),
    defineCommand('library.moveUp', () => shelf?.move(0, -1), navigable),
    defineCommand('library.moveDown', () => shelf?.move(0, 1), navigable),
    defineCommand('library.first', () => shelf?.edge(false), navigable),
    defineCommand('library.last', () => shelf?.edge(true), navigable),
    defineCommand('library.remove', withBook((b) => removeBook(b)), inLibrary),
    defineCommand('library.editMetadata', withBook((b) => void (lib.editing = b)), inLibrary),
    defineCommand('library.revealInExplorer', withBook((b) => core.revealInExplorer(b.id)), inLibrary),
    defineCommand('library.markFinished', withBook((b) => setStatus(b, 'finished')), inLibrary),
    defineCommand('library.markUnread', withBook((b) => setStatus(b, 'unread')), inLibrary),
    defineCommand('library.focusSearch', () => searchInput?.focus(), inLibrary),
    defineCommand('library.toggleView', () => setPrefs({ view: settings.value.library.view === 'grid' ? 'list' : 'grid' }), inLibrary),
    defineCommand('library.addFolder', () => addWatchedFolder()),
    defineCommand('library.newCollection', (args) => {
      lib.collectionDialog = { bookId: (args as { bookId?: string } | undefined)?.bookId };
    }),
    defineCommand('library.toggleCollection', (args) => {
      const a = args as { bookId?: string; collectionId?: string } | undefined;
      const bookId = a?.bookId ?? lib.selId;
      if (bookId && a?.collectionId) return toggleCollection(bookId, a.collectionId);
    }),
  ]);

  // Ctrl+P: fuzzy over title and author, most recent first
  let cache: { at: number; books: Book[] } | null = null;
  registerPaletteProvider({
    mode: 'books',
    label: 'Books',
    placeholder: 'Switch to a book by title or author',
    emptyText: 'No book matches',
    query: async (q) => {
      if (!cache || Date.now() - cache.at > 3000) cache = { at: Date.now(), books: await core.listBooks({ sort: 'recent' }) };
      const current = app.view === 'reader' ? app.book?.id : undefined;
      return rankItems(cache.books.filter((b) => b.id !== current), q.text, { fields: (b) => [b.title, b.author] })
        .slice(0, 50)
        .map(({ item: b, indices }) => ({
          id: b.id,
          title: b.title,
          detail: [b.author, b.progress ? percent(b.progress) : '', b.available ? '' : 'Unavailable'].filter(Boolean).join(' · '),
          indices,
          thumb: { src: b.coverUrl, hue: coverHue(b.title) },
          run: () => void openLibraryBook(b),
        }));
    },
  });

  void coreEvents.onLibraryChanged(() => {
    cache = null;
    scheduleReload();
    startCoverPass(coverSaved);
  });
  void coreEvents.onIngestProgress((p) => {
    lib.ingest = p.done < p.total ? p : null;
    if (p.done >= p.total) scheduleReload(0);
  });
  void coreEvents.onBackupRestored(() => {
    cache = null;
    void reload();
    void loadFolders();
  });
  void core.readingSpeed(null).then((s) => (lib.speed = s), () => {});
  // pending removals are committed if the window goes away
  window.addEventListener('pagehide', () => {
    for (const id of [...pendingTimers.keys()]) void core.removeBook(id);
  });
  startCoverPass(coverSaved);

  if (coreMode() === 'fake') (globalThis as Record<string, unknown>).__QUIRE_LIBRARY__ = { lib, core, reload };
}
