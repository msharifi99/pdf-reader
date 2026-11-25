/** In-memory backend for Playwright and browser dev. Typed against `CoreApi`: a missing command fails `tsc`. */
import type { Annotation, Book, BookIndex, Chunk, Collection, Format, IndexControl, IndexProgress, Json, OcrPage, OcrWordN, Progress, TextHit } from './bindings';
import type { CoreApi, CoreEvents, CoreRuntime, RawApi, Unlisten } from './core';

type Listener<T> = Set<(v: T) => void>;
const fail = (code: string, message: string): never => {
  throw { code, message };
};

const EXT: Record<string, Format> = { pdf: 'pdf', epub: 'epub', mobi: 'mobi', azw3: 'azw3', fb2: 'fb2', fbz: 'fbz', cbz: 'cbz', cbr: 'cbr', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image' };
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stem = (n: string) => n.replace(/\.[^.]+$/, '');
const uid = () => Math.random().toString(36).slice(2, 10);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** `"pdf/text.pdf"` keeps its folder (fixtures live in sub-folders); anything else flattens to the file name. */
const fixRel = (p: string) => (/^[\w.-]+\/[\w./-]+$/.test(p) ? p : base(p));
const cmpText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/** `public/fixtures/manifest.json`: `["a.pdf", ...]` or `[{ name, title?, author?, format? }]` (or `{ files: [...] }`). */
interface ManifestEntry {
  name: string;
  title?: string;
  author?: string;
  format?: Format;
  // Sample-library extras (T7): a rich fake library for screenshots and library tests.
  /** fixture actually served when the book opens (samples borrow a real fixture of their format) */
  file?: string;
  status?: Book['status'];
  progress?: number;
  /** minutes since last opened / days since added */
  openedMinutesAgo?: number;
  addedDaysAgo?: number;
  /** cover image URL (e.g. /fixtures/covers/x.webp); `needsCover: false` without one = typographic cover */
  cover?: string;
  needsCover?: boolean;
  available?: boolean;
  pageCount?: number;
  wordCount?: number;
  /** collection names, created on first use */
  collections?: string[];
}

const FAKE_DICTIONARY: Record<string, { pos: string; text: string; examples: string[]; synonyms: string[] }> = {
  run: { pos: 'verb', text: 'move fast by using one\'s feet', examples: ['She runs every morning'], synonyms: ['jog', 'sprint'] },
  goose: { pos: 'noun', text: 'a large waterbird with a long neck', examples: [], synonyms: [] },
  good: { pos: 'adjective', text: 'having desirable or positive qualities', examples: ['a good book'], synonyms: ['fine'] },
  book: { pos: 'noun', text: 'a written work bound together', examples: [], synonyms: ['volume'] },
};

export function createFakeRuntime(): CoreRuntime {
  const openFiles: Listener<string[]> = new Set();
  const maxHover: Listener<boolean> = new Set();
  const libChanged: Listener<string[]> = new Set();
  const ingest: Listener<{ done: number; total: number }> = new Set();
  const restored: Listener<void> = new Set();
  const indexProg: Listener<IndexProgress> = new Set();
  const indexCtl: Listener<IndexControl> = new Set();
  const settingsChanged: Listener<{ key: string; value: unknown }> = new Set();
  const flushReq: Listener<void> = new Set();
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
  // Stand-in for the core's `settings-changed` broadcast: pages of one browser profile share a channel.
  const chan = typeof BroadcastChannel === 'function' ? new BroadcastChannel('quire-fake-core') : null;
  if (chan)
    chan.onmessage = (e: MessageEvent<{ key: string; value: unknown }>) => {
      const { key, value } = e.data ?? {};
      if (typeof key !== 'string') return;
      if (value === null) settings.delete(key);
      else settings.set(key, value as Json);
      settingsChanged.forEach((cb) => cb({ key, value }));
    };
  const sessions = new Map<number, { bookId: string; start: number; end?: number; amount?: number; unit?: string }>();
  const folders: string[] = [];
  const fixtureName = new Map<string, string>(); // book id -> /fixtures file name
  let sessionSeq = 0;
  // Text index: chunks per book plus the run state, like the Rust `index_state` table.
  const INDEX_VERSION = 1;
  const textIndex = new Map<string, { chunks: Chunk[]; state: 'indexing' | 'done' | 'failed'; version: number; error: string | null; at: number }>();
  const ocrCache = new Map<string, Map<number, OcrPage>>();
  let reading = false;
  let ocrHook: ((req: { bookId: string; page: number; width: number; height: number; pixels: Uint8Array }) => OcrWordN[]) | null = null;

  const addBook = (path: string, e: Partial<ManifestEntry> = {}): Book => {
    const name = fixRel(path);
    const existing = [...books.values()].find((b) => b.path === path || fixtureName.get(b.id) === name);
    if (existing) return existing;
    let id = `fx-${stem(base(name))}`.replace(/[^\w-]/g, '_');
    if (books.has(id)) id = `fx-${base(name)}`.replace(/[^\w-]/g, '_'); // comic.cbz vs comic.cbr
    const b: Book = {
      id, fingerprint: id, format: e.format ?? EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'pdf',
      title: e.title ?? stem(base(name)), author: e.author ?? '', coverUrl: null, needsCover: true,
      pageCount: null, wordCount: null, status: 'unread', addedAt: Date.now() + books.size, lastOpenedAt: null,
      fileSize: 0, settings: {}, available: true, path, progress: null, collections: [],
    };
    books.set(id, b);
    fixtureName.set(id, name);
    return b;
  };

  const sample = (b: Book, e: ManifestEntry) => {
    const now = Date.now();
    if (e.file) fixtureName.set(b.id, e.file);
    if (e.status) b.status = e.status;
    if (e.progress != null) progress.set(b.id, { bookId: b.id, locator: null, fraction: e.progress, updatedAt: now });
    if (e.openedMinutesAgo != null) b.lastOpenedAt = now - e.openedMinutesAgo * 60000;
    if (e.addedDaysAgo != null) b.addedAt = now - e.addedDaysAgo * 86400000;
    if (e.cover) b.coverUrl = e.cover;
    if (e.cover || e.needsCover === false) b.needsCover = false;
    if (e.available === false) b.available = false;
    if (e.pageCount) b.pageCount = e.pageCount;
    if (e.wordCount) b.wordCount = e.wordCount;
    for (const name of e.collections ?? []) {
      let c = [...collections.values()].find((x) => x.name === name);
      if (!c) collections.set((c = { id: uid(), name, count: 0 }).id, c), membership.set(c.id, new Set());
      membership.get(c.id)!.add(b.id);
    }
  };

  let seeded: Promise<void> | undefined;
  const seed = () =>
    (seeded ??= (async () => {
      try {
        if (new URLSearchParams(location.search).has('empty')) return; // an empty library on demand
        const r = await fetch('/fixtures/manifest.json');
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
        const m: unknown = await r.json();
        const list = Array.isArray(m) ? m : Array.isArray(obj(m).files) ? (obj(m).files as unknown[]) : [];
        for (const e of list) {
          const entry = typeof e === 'string' ? { name: e } : (e as ManifestEntry);
          if (entry?.name) sample(addBook(entry.name, entry), entry);
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


  // ---- full-text index (same query semantics as src-tauri/src/backend/index.rs) ----------------
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const tokens = (s: string) => [...s.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, w: fold(m[0]) }));
  /** Bare words ANDed, "quoted" = phrase, the word being typed matches as a prefix. */
  const parseQuery = (input: string): { terms: string[][]; prefix: boolean } | null => {
    const words = (s: string) => tokens(s).map((t) => t.w.slice(0, 64));
    const terms: string[][] = [];
    input.split('"').forEach((seg, i) => {
      if (i % 2 === 1) {
        const w = words(seg);
        if (w.length) terms.push(w);
      } else for (const piece of seg.split(/\s+/)) if (words(piece).length) terms.push(words(piece));
    });
    if (!terms.length) return null;
    const open = (input.match(/"/g)?.length ?? 0) % 2 === 1;
    return { terms: terms.slice(0, 16), prefix: open || /[\p{L}\p{N}]$/u.test(input) };
  };
  const matchesAt = (toks: { w: string }[], term: string[], prefixLast: boolean): number[] => {
    const out: number[] = [];
    for (let i = 0; i + term.length <= toks.length; i++)
      if (term.every((w, k) => (k === term.length - 1 && prefixLast ? toks[i + k].w.startsWith(w) : toks[i + k].w === w))) out.push(i);
    return out;
  };
  const searchText = (query: string, limit: number): TextHit[] => {
    const q = parseQuery(query);
    if (!q) return [];
    const scored: { hit: TextHit; score: number }[] = [];
    for (const [bookId, ix] of textIndex) {
      const b = books.get(bookId);
      if (!b || removed.has(bookId)) continue;
      const perBook: { hit: TextHit; score: number }[] = [];
      for (const c of ix.chunks) {
        const toks = tokens(c.text);
        const found = q.terms.map((t, i) => matchesAt(toks, t, q.prefix && i === q.terms.length - 1));
        if (found.some((f) => !f.length)) continue;
        const marked = new Set<number>();
        q.terms.forEach((t, i) => found[i].forEach((at) => t.forEach((_, k) => marked.add(at + k))));
        const first = Math.min(...found.map((f) => f[0]));
        const lo = Math.max(0, first - 12);
        const hi = Math.min(toks.length, first + 13);
        let snippet = lo > 0 ? '…' : '';
        for (let i = lo; i < hi; i++) {
          const t = toks[i];
          const gap = i === lo ? '' : c.text.slice(toks[i - 1].end, t.start);
          snippet += gap + (marked.has(i) ? `<mark>${c.text.slice(t.start, t.end)}</mark>` : c.text.slice(t.start, t.end));
        }
        if (hi < toks.length) snippet += '…';
        const score = marked.size / Math.sqrt(toks.length || 1);
        perBook.push({ score, hit: { bookId, bookTitle: b.title, locator: c.locator, snippet } });
      }
      scored.push(...perBook.sort((a, b2) => b2.score - a.score).slice(0, 5));
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.hit);
  };
  const indexable = (b: Book) => !removed.has(b.id) && b.available && (!['cbz', 'cbr', 'image'].includes(b.format) || (ocrCache.get(b.id)?.size ?? 0) > 0);
  const bookIndexState = (id: string): BookIndex => {
    const ix = textIndex.get(id);
    const state = !ix ? 'pending' : ix.state === 'done' && ix.version < INDEX_VERSION ? 'pending' : ix.state;
    return { bookId: id, state, chunks: ix?.chunks.length ?? 0, error: ix?.error ?? null };
  };
  const indexCounts = () => {
    const list = [...books.values()].filter(indexable).map((b) => bookIndexState(b.id));
    return { done: list.filter((i) => i.state === 'done').length, total: list.length, failed: list.filter((i) => i.state === 'failed').length };
  };
  const emitProgress = (current: string | null) => indexProg.forEach((cb) => cb({ ...indexCounts(), current }));

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
    // A browser has one window: the UI falls back to opening in place, so this is never called.
    openBookWindow: async () => 'reader-1',
    windowSetBook: async () => {},
    flushDone: async () => {},
    // The persisted session is `localStorage['quire.fake.session']` in the Rust format, so tests can plant one.
    takeSessionBook: async () => {
      const raw = localStorage.getItem('quire.fake.session');
      localStorage.removeItem('quire.fake.session');
      if (!raw || settings.get('restoreSession') === false) return null;
      try {
        const s = JSON.parse(raw) as { windows?: { label: string; bookId?: string | null }[] };
        return s.windows?.find((w) => w.label === 'main')?.bookId ?? null;
      } catch {
        return null;
      }
    },

    // ---- library ----
    openDocument: async (path) => {
      await seed();
      const b = addBook(path);
      if (!b.available) fail('NotFound', "Couldn't find that file.");
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
    restoreBook: async (id) => (need(id), removed.delete(id), null),
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
    // Fixture folders ship an index.json (the real command is Rust); a single-image path lists its folder.
    listImageFolder: async (path) => {
      const p = path.replace(/\\/g, '/');
      const dir = /\.[a-z0-9]+$/i.test(p) ? p.replace(/\/[^/]*$/, '') : p;
      const names: string[] = await fetch(`/fixtures/${dir}/index.json`).then((r) => (r.ok ? r.json() : []), () => []);
      return names.map((n) => `${dir}/${n}`);
    },

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
    setSetting: async (key, value) => {
      if (value === null) settings.delete(key);
      else settings.set(key, value);
      // a second window (page) of the same browser profile hears it, like the core's settings-changed event
      try {
        chan?.postMessage({ key, value });
      } catch {
        /* unclonable value: the other window keeps its own */
      }
      return null;
    },
    getAllSettings: async () => Object.fromEntries(settings),
    listWatchedFolders: async () => [...folders],
    addWatchedFolder: async (path) => (folders.includes(path) || folders.push(path), null),
    removeWatchedFolder: async (path) => (folders.splice(0, folders.length, ...folders.filter((f) => f !== path)), null),
    rescanWatchedFolders: async () => null,
    listSystemFonts: async () => ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Georgia', 'Segoe UI', 'Times New Roman', 'Verdana'],
    searchLibraryText: async (query, limit) => (await seed(), searchText(query, limit)),
    indexBookChunks: async (bookId, chunks, first, done) => {
      need(bookId);
      let ix = textIndex.get(bookId);
      if (first) textIndex.set(bookId, (ix = { chunks: [], state: 'indexing', version: INDEX_VERSION, error: null, at: Date.now() }));
      else if (ix?.state !== 'indexing') fail('Invalid', 'This book has no index run in progress; start one with first=true.');
      ix!.chunks.push(...chunks.filter((c) => c.text.trim()).map((c) => ({ locator: c.locator, text: c.text.trim() })));
      if (done) ix!.state = 'done';
      if (first || done) emitProgress(done ? null : bookId);
      return null;
    },
    indexStatus: async () => {
      await seed();
      return { ...indexCounts(), paused: reading, books: [...books.values()].filter(indexable).map((b) => bookIndexState(b.id)) };
    },
    booksNeedingIndex: async (limit) => {
      await seed();
      return visible()
        .filter((b) => indexable(b) && !['done', 'failed'].includes(bookIndexState(b.id).state))
        .slice(0, limit);
    },
    markIndexFailed: async (bookId, reason) => {
      need(bookId);
      textIndex.set(bookId, { chunks: [], state: 'failed', version: INDEX_VERSION, error: reason, at: Date.now() });
      emitProgress(null);
      return null;
    },
    clearIndex: async (bookId) => (textIndex.delete(bookId), emitProgress(null), null),
    setReadingActive: async (active) => {
      if (reading !== active) {
        reading = active;
        indexCtl.forEach((cb) => cb({ paused: active }));
      }
      return null;
    },

    // ---- dictionary (a tiny stand-in for the WordNet db) ----
    lookupWord: async (word) => {
      const k = word.trim().toLowerCase();
      const lemma = ({ running: 'run', ran: 'run', geese: 'goose', better: 'good' } as Record<string, string>)[k] ?? k;
      const def = FAKE_DICTIONARY[lemma];
      return def ? { lemma, form: k, entries: [{ lemma, pos: def.pos, definitions: [{ text: def.text, examples: def.examples }], synonyms: def.synonyms }] } : null;
    },
    suggestWords: async (prefix, limit) => Object.keys(FAKE_DICTIONARY).filter((w) => w.startsWith(prefix.trim().toLowerCase())).slice(0, limit),

    // ---- OCR ----
    ocrLanguages: async () => [{ tag: 'en-US', name: 'English (United States)', default: true }],
    getOcrPages: async (bookId) => [...(ocrCache.get(bookId)?.values() ?? [])].sort((a, b) => a.page - b.page),
    ocrStatus: async (bookId) => ({ pagesDone: ocrCache.get(bookId)?.size ?? 0, lang: ocrCache.get(bookId)?.size ? 'en-US' : null }),
    clearOcr: async (bookId) => (ocrCache.delete(bookId), textIndex.delete(bookId), null),
    backup: async () => null,
    restore: async () => (restored.forEach((cb) => cb()), null),
  };

  const events: CoreEvents = {
    onOpenFiles: (cb) => sub(openFiles, cb),
    onMaxButtonHover: (cb) => sub(maxHover, cb),
    onLibraryChanged: (cb) => sub(libChanged, cb),
    onIngestProgress: (cb) => sub(ingest, cb),
    onBackupRestored: (cb) => sub(restored, () => cb()),
    onSettingsChanged: (cb) => sub(settingsChanged, (m) => cb(m.key, m.value)),
    onFlushRequest: (cb) => sub(flushReq, () => cb()),
    onIndexProgress: (cb) => sub(indexProg, cb),
    onIndexControl: (cb) => sub(indexCtl, cb),
  };

  const raw: RawApi = {
    ocrPage: async (req, pixels) => {
      need(req.bookId);
      const page: OcrPage = { page: req.page, lang: 'en-US', words: ocrHook?.({ ...req, pixels }) ?? [] };
      (ocrCache.get(req.bookId) ?? ocrCache.set(req.bookId, new Map()).get(req.bookId)!).set(req.page, page);
      return page;
    },
    saveCover: (id, bytes) => api.saveCover(id, [...bytes]),
  };

  // Test hooks: Playwright drives backend-originated events through this.
  (globalThis as Record<string, unknown>).__QUIRE_FAKE__ = {
    emitOpenFiles: (paths: string[]) => openFiles.forEach((cb) => cb(paths)),
    emitMaxButtonHover: (h: boolean) => maxHover.forEach((cb) => cb(h)),
    /** The fake backend itself (tests read and write it directly). */
    api,
    /** The core asked this window to flush (it is closing). */
    requestFlush: () => flushReq.forEach((cb) => cb()),
    emitLibraryChanged: (ids: string[] = []) => announce(ids),
    setLaunchFiles: (paths: string[]) => (launchFiles = paths),
    /** Stand-in for Windows OCR: gets the page request plus its RGBA pixels, returns words (boxes normalised 0..1). Default: no words. */
    setOcr: (fn: typeof ocrHook) => (ocrHook = fn),
    /** Is the (fake) indexer paused because a book is being read? */
    isReading: () => reading,
    /** Add a fixture book by file name (no manifest needed) and announce it. */
    /** Drop every book (after the manifest seed) plus index/OCR state, so a test controls exactly what is in the library. */
    resetLibrary: async () => {
      await seed();
      books.clear();
      removed.clear();
      fixtureName.clear();
      textIndex.clear();
      ocrCache.clear();
      progress.clear();
      collections.clear();
      membership.clear();
    },
    addFixture: (name: string, e: Partial<ManifestEntry> = {}) => {
      const b = addBook(name, e);
      sample(b, { name, ...e }); // status, progress, cover, collections... as in manifest.json
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
    raw,
    events,
    // A relative "folder/file" path (fixture sub-folders such as comic/images) keeps its folder; absolute paths flatten to the file name.
    fileUrl: (ref) => ('path' in ref ? `/fixtures/${fixRel(ref.path)}` : `/fixtures/${fixtureName.get(ref.bookId) ?? ref.bookId}`),
  };
}
