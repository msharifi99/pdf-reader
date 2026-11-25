/** In-memory backend for Playwright and browser dev. Typed against `CoreApi`: a missing command fails `tsc`. */
import type { Annotation, Book, Collection, Format, Json, Progress } from './bindings';
import type { CoreApi, CoreEvents, CoreRuntime, Unlisten } from './core';

type Listener<T> = Set<(v: T) => void>;
const fail = (code: string, message: string): never => {
  throw { code, message };
};

const EXT: Record<string, Format> = { pdf: 'pdf', epub: 'epub', mobi: 'mobi', azw3: 'azw3', fb2: 'fb2', fbz: 'fbz', cbz: 'cbz', cbr: 'cbr', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image' };
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stem = (n: string) => n.replace(/\.[^.]+$/, '');
const uid = () => Math.random().toString(36).slice(2, 10);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const cmpText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/** `public/fixtures/manifest.json`: `["a.pdf", ...]` or `[{ name, title?, author?, format? }]` (or `{ files: [...] }`). */
interface ManifestEntry {
  name: string;
  title?: string;
  author?: string;
  format?: Format;
}

export function createFakeRuntime(): CoreRuntime {
  const openFiles: Listener<string[]> = new Set();
  const maxHover: Listener<boolean> = new Set();
  const libChanged: Listener<string[]> = new Set();
  const ingest: Listener<{ done: number; total: number }> = new Set();
  const restored: Listener<void> = new Set();
  let launchFiles: string[] = [];

  const sub = <T>(set: Listener<T>, cb: (v: T) => void): Promise<Unlisten> => {
    set.add(cb);
    return Promise.resolve(() => void set.delete(cb));
  };

  // ---- state ---------------------------------------------------------------------------
  const books = new Map<string, Book>();
  const removed = new Set<string>();
  const progress = new Map<string, Progress>();
  const annotations = new Map<string, Annotation>();
  const collections = new Map<string, Collection>();
  const membership = new Map<string, Set<string>>(); // collection id -> book ids
  const settings = new Map<string, Json>();
  const sessions = new Map<number, { bookId: string; start: number; end?: number; amount?: number; unit?: string }>();
  const folders: string[] = [];
  const fixtureName = new Map<string, string>(); // book id -> /fixtures file name
  let sessionSeq = 0;

  const addBook = (path: string, e: Partial<ManifestEntry> = {}): Book => {
    const name = base(path);
    const existing = [...books.values()].find((b) => fixtureName.get(b.id) === name);
    if (existing) return existing;
    const id = `fx-${stem(name)}`.replace(/[^\w-]/g, '_');
    const b: Book = {
      id, fingerprint: id, format: e.format ?? EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'pdf',
      title: e.title ?? stem(name), author: e.author ?? '', coverUrl: null, needsCover: true,
      pageCount: null, wordCount: null, status: 'unread', addedAt: Date.now() + books.size, lastOpenedAt: null,
      fileSize: 0, settings: {}, available: true, path, progress: null, collections: [],
    };
    books.set(id, b);
    fixtureName.set(id, name);
    return b;
  };

  let seeded: Promise<void> | undefined;
  const seed = () =>
    (seeded ??= (async () => {
      try {
        const r = await fetch('/fixtures/manifest.json');
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
        const m: unknown = await r.json();
        const list = Array.isArray(m) ? m : Array.isArray(obj(m).files) ? (obj(m).files as unknown[]) : [];
        for (const e of list) {
          const entry = typeof e === 'string' ? { name: e } : (e as ManifestEntry);
          if (entry?.name) addBook(entry.name, entry);
        }
      } catch {
        /* no manifest: start empty */
      }
    })());

  const need = (id: string): Book => books.get(id) ?? fail('NotFound', "Couldn't find that book.");
  const needAnn = (id: string): Annotation => annotations.get(id) ?? fail('NotFound', "Couldn't find that annotation.");
  const view = (b: Book): Book => ({
    ...b,
    progress: progress.get(b.id)?.fraction ?? null,
    collections: [...collections.keys()].filter((c) => membership.get(c)?.has(b.id)),
  });
  const visible = () => [...books.values()].filter((b) => !removed.has(b.id)).map(view);
  const announce = (ids: string[]) => libChanged.forEach((cb) => cb(ids));

  const posKey = (a: Annotation): number => {
    const l = obj(obj(a.anchor).locator);
    return l.kind === 'fixed' ? Number(l.page ?? 0) * 1e6 + Number(l.y ?? 0) * 999999 : Number(l.fraction ?? 0) * 1e6;
  };
  const annText = (a: Annotation) => `${a.note ?? ''} ${a.label ?? ''} ${obj(obj(a.anchor).quote).exact ?? ''}`.toLowerCase();

  const sorts = {
    recent: (a: Book, b: Book) => (b.lastOpenedAt ?? -1) - (a.lastOpenedAt ?? -1) || b.addedAt - a.addedAt,
    added: (a: Book, b: Book) => b.addedAt - a.addedAt,
    title: (a: Book, b: Book) => cmpText(a.title, b.title),
    author: (a: Book, b: Book) => Number(a.author === '') - Number(b.author === '') || cmpText(a.author, b.author) || cmpText(a.title, b.title),
    progress: (a: Book, b: Book) => (b.progress ?? 0) - (a.progress ?? 0) || (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0),
  };

  /** Median of recent sessions in `unit`; the book's own if it has 3+, else all. */
  const speed = (unit: string, lo: number, hi: number, bookId: string | null) => {
    const done = [...sessions.values()].filter((s) => s.unit === unit && s.end && (s.amount ?? 0) > 0 && s.end - s.start >= 20000);
    const own = bookId ? done.filter((s) => s.bookId === bookId) : [];
    const r = (own.length >= 3 ? own : done)
      .slice(-20)
      .map((s) => s.amount! / ((s.end! - s.start) / 60000))
      .filter((x) => x >= lo && x <= hi)
      .sort((a, b) => a - b);
    return r.length ? r[Math.floor(r.length / 2)] : undefined;
  };

  const api: CoreApi = {
    appVersion: async () => __APP_VERSION__,
    takeLaunchFiles: async () => {
      const f = launchFiles;
      launchFiles = [];
      return f;
    },
    allowPath: async () => true,
    windowBackdrop: async () => 'none',
    windowMinimize: async () => {},
    windowToggleMaximize: async () => {},
    windowClose: async () => {},
    windowToggleFullscreen: async () => {},
    windowStartDrag: async () => {},
    windowSetMaxbtnRect: async () => {},

    // ---- library ----
    openDocument: async (path) => {
      await seed();
      const b = addBook(path);
      removed.delete(b.id);
      b.lastOpenedAt = Date.now();
      announce([b.id]);
      return { book: view(b), progress: progress.get(b.id) ?? null, startImage: b.format === 'image' ? path : null };
    },
    listBooks: async (q) => {
      await seed();
      const words = (q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const v = visible()
        .filter(
          (b) =>
            (!q.formats?.length || q.formats.includes(b.format)) &&
            (!q.status || b.status === q.status) &&
            (!q.collection || b.collections.includes(q.collection)) &&
            words.every((w) => `${b.title} ${b.author}`.toLowerCase().includes(w)),
        )
        .sort(sorts[q.sort ?? 'recent']);
      return q.reverse ? v.reverse() : v;
    },
    getBook: async (id) => (await seed(), view(need(id))),
    continueReading: async (limit) =>
      (await seed(), visible().filter((b) => b.status === 'reading').sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)).slice(0, limit)),
    removeBook: async (id) => (removed.add(need(id).id), null),
    setBookStatus: async (id, status) => ((need(id).status = status), null),
    setBookSettings: async (id, patch) => {
      const b = need(id);
      const merged = { ...obj(b.settings) };
      for (const [k, v] of Object.entries(obj(patch))) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      return (b.settings = merged);
    },
    setBookMetadata: async (id, p) => {
      const b = need(id);
      if (p.title?.trim()) b.title = p.title.trim();
      if (p.author != null) b.author = p.author.trim();
      if (p.pageCount != null) b.pageCount = p.pageCount;
      if (p.wordCount != null) b.wordCount = p.wordCount;
      return view(b);
    },
    saveCover: async (id, bytes) => {
      const b = need(id);
      b.needsCover = false;
      if (bytes.length) b.coverUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/webp' }));
      return view(b);
    },
    coverUrl: async (id) => need(id).coverUrl,
    booksNeedingCovers: async () => (await seed(), visible().filter((b) => b.needsCover && b.available)),
    revealInExplorer: async (id) => (need(id), null),
    listImageFolder: async () => [],

    // ---- collections ----
    listCollections: async () =>
      [...collections.values()]
        .map((c) => ({ ...c, count: [...(membership.get(c.id) ?? [])].filter((b) => !removed.has(b)).length }))
        .sort((a, b) => cmpText(a.name, b.name)),
    createCollection: async (name) => {
      const n = name.trim();
      if (!n) fail('Invalid', 'A collection needs a name.');
      if ([...collections.values()].some((c) => c.name.toLowerCase() === n.toLowerCase())) fail('Invalid', 'You already have a collection with that name.');
      const c = { id: uid(), name: n, count: 0 };
      collections.set(c.id, c);
      membership.set(c.id, new Set());
      return c;
    },
    renameCollection: async (id, name) => {
      (collections.get(id) ?? fail('NotFound', "Couldn't find that collection.")).name = name.trim();
      return null;
    },
    deleteCollection: async (id) => (collections.delete(id), membership.delete(id), null),
    addToCollection: async (bookId, cid) => (need(bookId), (membership.get(cid) ?? fail('NotFound', "Couldn't find that collection.")).add(bookId), null),
    removeFromCollection: async (bookId, cid) => (membership.get(cid)?.delete(bookId), null),

    // ---- progress and sessions ----
    saveProgress: async (bookId, locator, fraction) => {
      const b = need(bookId);
      const f = Math.min(1, Math.max(0, fraction ?? 0));
      progress.set(bookId, { bookId, locator, fraction: f, updatedAt: Date.now() });
      if (f >= 0.995) b.status = 'finished';
      else if (f > 0) b.status = 'reading';
      return null;
    },
    getProgress: async (bookId) => progress.get(bookId) ?? null,
    startSession: async (bookId) => (need(bookId), sessions.set(++sessionSeq, { bookId, start: Date.now() }), sessionSeq),
    endSession: async (id, amount, unit) => {
      const s = sessions.get(id) ?? fail('NotFound', "Couldn't find that session.");
      Object.assign(s, { end: Date.now(), amount: amount ?? 0, unit });
      return null;
    },
    readingSpeed: async (bookId) => {
      const ppm = speed('pages', 0.1, 30, bookId);
      return { wordsPerMinute: speed('words', 40, 2000, bookId) ?? 250, minutesPerPage: ppm ? 1 / ppm : 1.2 };
    },

    // ---- annotations ----
    createAnnotation: async (n) => {
      need(n.bookId);
      const now = Date.now();
      const a: Annotation = { id: crypto.randomUUID(), bookId: n.bookId, type: n.type, color: n.color, anchor: n.anchor, note: n.note, label: n.label, createdAt: now, updatedAt: now, deletedAt: null };
      annotations.set(a.id, a);
      return a;
    },
    updateAnnotation: async (id, p) => {
      const a = needAnn(id);
      if (p.type) a.type = p.type;
      if (p.color != null) a.color = p.color;
      if (p.anchor != null) a.anchor = p.anchor;
      if (p.note != null) a.note = p.note;
      if (p.label != null) a.label = p.label;
      a.updatedAt = Date.now();
      return { ...a };
    },
    deleteAnnotation: async (id) => ((needAnn(id).deletedAt = Date.now()), null),
    restoreAnnotation: async (id) => {
      const a = needAnn(id);
      a.deletedAt = null;
      return { ...a };
    },
    listAnnotations: async (bookId) =>
      [...annotations.values()].filter((a) => a.bookId === bookId && a.deletedAt == null).sort((a, b) => posKey(a) - posKey(b) || a.createdAt - b.createdAt),
    listAllAnnotations: async (query) => {
      const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      return [...annotations.values()]
        .filter((a) => a.deletedAt == null && books.has(a.bookId) && !removed.has(a.bookId) && words.every((w) => annText(a).includes(w)))
        .map((annotation) => ({ annotation, bookTitle: books.get(annotation.bookId)!.title, bookAuthor: books.get(annotation.bookId)!.author }))
        .sort((x, y) => cmpText(x.bookTitle, y.bookTitle) || posKey(x.annotation) - posKey(y.annotation));
    },

    // ---- settings, folders, misc ----
    getSetting: async (key) => settings.get(key) ?? null,
    setSetting: async (key, value) => (value === null ? settings.delete(key) : settings.set(key, value), null),
    getAllSettings: async () => Object.fromEntries(settings),
    listWatchedFolders: async () => [...folders],
    addWatchedFolder: async (path) => (folders.includes(path) || folders.push(path), null),
    removeWatchedFolder: async (path) => (folders.splice(0, folders.length, ...folders.filter((f) => f !== path)), null),
    rescanWatchedFolders: async () => null,
    listSystemFonts: async () => ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Georgia', 'Segoe UI', 'Times New Roman', 'Verdana'],
    searchLibraryText: async (query, limit) => {
      // No text index in the fake: match titles so UI has something to render.
      const q = query.toLowerCase();
      return visible()
        .filter((b) => q && b.title.toLowerCase().includes(q))
        .slice(0, limit)
        .map((b) => {
          const i = b.title.toLowerCase().indexOf(q);
          const snippet = `${b.title.slice(0, i)}<mark>${b.title.slice(i, i + q.length)}</mark>${b.title.slice(i + q.length)}`;
          return { bookId: b.id, bookTitle: b.title, locator: { kind: 'fixed', page: 0 }, snippet };
        });
    },
    backup: async () => null,
    restore: async () => (restored.forEach((cb) => cb()), null),
  };

  const events: CoreEvents = {
    onOpenFiles: (cb) => sub(openFiles, cb),
    onMaxButtonHover: (cb) => sub(maxHover, cb),
    onLibraryChanged: (cb) => sub(libChanged, cb),
    onIngestProgress: (cb) => sub(ingest, cb),
    onBackupRestored: (cb) => sub(restored, () => cb()),
  };

  // Test hooks: Playwright drives backend-originated events through this.
  (globalThis as Record<string, unknown>).__QUIRE_FAKE__ = {
    emitOpenFiles: (paths: string[]) => openFiles.forEach((cb) => cb(paths)),
    emitMaxButtonHover: (h: boolean) => maxHover.forEach((cb) => cb(h)),
    emitLibraryChanged: (ids: string[] = []) => announce(ids),
    setLaunchFiles: (paths: string[]) => (launchFiles = paths),
    /** Add a fixture book by file name (no manifest needed) and announce it. */
    addFixture: (name: string, e: Partial<ManifestEntry> = {}) => {
      const b = addBook(name, e);
      announce([b.id]);
      return b.id;
    },
    setAvailable: (id: string, available: boolean) => {
      need(id).available = available;
      announce([id]);
    },
  };

  return {
    mode: 'fake',
    api,
    events,
    fileUrl: (ref) => ('path' in ref ? `/fixtures/${base(ref.path)}` : `/fixtures/${fixtureName.get(ref.bookId) ?? ref.bookId}`),
  };
}
