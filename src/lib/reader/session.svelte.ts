/**
 * One open book in the reader: engine, handle, position, per-book presentation, history, progress.
 * Created by ReaderView per mount; `readerApi.session` exposes the live one to T11/T13 (see slots.svelte.ts).
 */
import { core, fileUrl, raw } from '../core/core';
import { onFlush } from '../core/flush';
import { engineKindFor, sniffSource } from '../engines/sniff';
import type {
  Anchor, BookHandle, BookSource, Decoration, DecorationLayer, Engine, EngineKind, EngineSelection, Fit, Flow, Locator, PageTint, Presentation,
  ReadingDirection, RelocatedEvent, Spread, TypographyProfile,
} from '../engines/types';
import type { OpenBook } from '../stores/app.svelte';
import { settings, type ComicMode } from '../stores/settings.svelte';
import { activeTheme } from '../shell/theme.svelte';
import { History, samePlace } from './history';
import { createProgressSaver, flattenToc, type FlatToc } from './progress';

/** What `setBookSettings` stores per book (core `books.settings` JSON). */
export interface BookSettings {
  flow?: Flow;
  spread?: Spread;
  zoom?: number;
  fit?: Fit;
  rotation?: 0 | 90 | 180 | 270;
  pageTint?: PageTint;
  direction?: ReadingDirection;
  /** "This book only" typography override; absent = the global profile */
  typography?: TypographyProfile;
  comicMode?: ComicMode;
  /** the scanned-book OCR offer was dismissed */
  ocrDismissed?: boolean;
}

/** Engine extras the shell uses when present (feature-detected, never by format). */
type Extras = Engine & {
  zoomBy?(factor: number): void;
  turnToward?(side: 'left' | 'right'): Promise<boolean>;
  setExternalLinkHandler?(fn: ((href: string) => void) | undefined): void;
  setOptions?(o: { animatePageTurns?: boolean; dimImages?: boolean }): void;
};

export async function createEngine(kind: EngineKind): Promise<Engine> {
  if (kind === 'pdf') return (await import('../engines/pdf')).createPdfEngine();
  if (kind === 'comic') return (await import('../engines/comic')).createComicEngine();
  return (await import('../engines/reflow')).createReflowEngine();
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const isLibraryId =(id: string) => !/^(file|path):/.test(id);
const quiet = <T>(p: Promise<T> | undefined): Promise<T | undefined> => (p ?? Promise.resolve(undefined)).catch((e) => (console.debug('[reader]', e), undefined));

export class ReaderSession {
  readonly book: OpenBook;
  readonly kind: EngineKind;
  engine = $state.raw<Extras | null>(null);
  handle = $state.raw<BookHandle | null>(null);
  status = $state<'opening' | 'ready' | 'failed'>('opening');
  location = $state.raw<RelocatedEvent | null>(null);
  bookSettings = $state<BookSettings>({});
  /** effective zoom the engine reports (fit modes resolve to a number) */
  zoom = $state(1);
  selection = $state.raw<EngineSelection | null>(null);
  speed = $state({ wordsPerMinute: 250, minutesPerPage: 1.2 });
  flat = $state.raw<FlatToc[]>([]);
  openMs = $state(0);
  history = new History();
  historyRev = $state(0);
  /** a book record from the core (null for ad-hoc files) */
  needsCover = false;

  #saver = createProgressSaver((loc, f) => (isLibraryId(this.book.id) ? core.saveProgress(this.book.id, loc, f) : Promise.resolve()));
  #offs: (() => void)[] = [];
  #sessionId: number | null = null;
  #seenPages = new Set<number>();
  #wordsRead = 0;
  #lastFraction: number | null = null;
  #applied: Partial<Record<keyof Presentation, string>> = {};
  #selectionSubs = new Set<(s: EngineSelection | null) => void>();
  #settingsTimer: ReturnType<typeof setTimeout> | undefined;
  #settingsPatch: Record<string, unknown> = {};
  #abort = new AbortController();
  #imageNames: string[] = [];
  #disposed = false;

  constructor(book: OpenBook) {
    this.book = book;
    this.kind = engineKindFor(book.format);
    this.#offs.push(onFlush(() => this.flush())); // the window is closing: write the position now
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  // ---- effective presentation ------------------------------------------------------------

  get comicMode(): ComicMode {
    return this.bookSettings.comicMode ?? settings.value.comicMode;
  }
  get flow(): Flow {
    if (this.kind === 'comic') return this.comicMode === 'webtoon' ? 'scrolled' : 'paginated';
    return this.bookSettings.flow ?? (this.kind === 'pdf' ? settings.value.flowPdf : settings.value.flowReflow);
  }
  get spread(): Spread {
    if (this.kind === 'comic') return this.comicMode === 'double' ? 'double' : 'single';
    return this.bookSettings.spread ?? (this.kind === 'pdf' ? 'single' : 'auto');
  }
  get defaultFit(): Fit {
    return this.kind === 'comic' || this.flow === 'paginated' ? 'page' : 'width'; // paginated = one whole page per screen
  }
  get fit(): Fit {
    return this.bookSettings.fit ?? this.defaultFit;
  }
  get pageTint(): PageTint {
    return this.bookSettings.pageTint ?? (this.kind === 'comic' ? 'original' : settings.value.pageTint);
  }
  get direction(): ReadingDirection {
    return this.bookSettings.direction ?? this.handle?.metadata.direction ?? 'ltr';
  }
  get typography(): TypographyProfile {
    return this.bookSettings.typography ?? settings.value.typography;
  }
  get typographyOverride(): boolean {
    return !!this.bookSettings.typography;
  }

  presentation(): Presentation {
    return {
      theme: activeTheme(),
      pageTint: this.pageTint,
      typography: this.typography,
      flow: this.flow,
      spread: this.spread,
      zoom: this.bookSettings.zoom ?? 1,
      fit: this.fit,
      rotation: this.bookSettings.rotation ?? 0,
      direction: this.direction,
    };
  }

  /** Push only what changed to the engine (each change can re-lay-out). */
  applyPresentation(): void {
    const e = this.engine;
    if (!e) return;
    const p = this.presentation();
    const patch: Partial<Presentation> = {};
    for (const k of Object.keys(p) as (keyof Presentation)[]) {
      const key = k === 'theme' ? p.theme.id + JSON.stringify(p.theme) : JSON.stringify(p[k]);
      if (this.#applied[k] !== key) {
        this.#applied[k] = key;
        (patch as Record<string, unknown>)[k] = $state.snapshot(p[k]);
      }
    }
    if (Object.keys(patch).length) e.setPresentation(patch);
  }

  /** Merge into the per-book settings and persist (debounced; `null` removes a key). */
  setBookSetting(patch: { [K in keyof BookSettings]?: BookSettings[K] | null }): void {
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete (this.bookSettings as Record<string, unknown>)[k];
      else (this.bookSettings as Record<string, unknown>)[k] = v;
      this.#settingsPatch[k] = v ?? null;
    }
    this.applyPresentation();
    clearTimeout(this.#settingsTimer);
    this.#settingsTimer = setTimeout(() => void this.#flushSettings(), 300);
  }

  async #flushSettings(): Promise<void> {
    clearTimeout(this.#settingsTimer);
    const patch = this.#settingsPatch;
    this.#settingsPatch = {};
    if (!Object.keys(patch).length || !isLibraryId(this.book.id)) return;
    await quiet(core.setBookSettings(this.book.id, $state.snapshot(patch)));
  }

  // ---- open ------------------------------------------------------------------------------

  /**
   * Sniff, create the engine, open (password prompts via `requestPassword`), apply per-book
   * presentation, render at the saved position. Rejects with the engine's typed error.
   */
  async open(stage: HTMLElement, requestPassword: (retry: boolean) => Promise<string | null>): Promise<void> {
    const t0 = performance.now();
    const signal = this.#abort.signal;
    const id = this.book.id;
    const record = isLibraryId(id) ? quiet(core.getBook(id)) : Promise.resolve(undefined);
    const speed = isLibraryId(id) ? quiet(core.readingSpeed(id)) : Promise.resolve(undefined);
    const [source, kind] = await this.#source(signal);
    const engine = (await createEngine(kind)) as Extras;
    if (this.#disposed) {
      engine.dispose();
      return;
    }
    this.engine = engine;
    this.#wire(engine);
    const rec = await record;
    if (rec?.settings && typeof rec.settings === 'object') Object.assign(this.bookSettings, rec.settings as BookSettings);
    this.needsCover = !!rec?.needsCover;
    const handle = await engine.open(source, { signal, requestPassword });
    if (this.#disposed) return;
    this.handle = handle;
    this.flat = flattenToc(handle.toc);
    engine.setOptions?.({ animatePageTurns: settings.value.pageAnimations });
    this.applyPresentation();
    await engine.render(stage, this.startLocator());
    if (this.#disposed) return;
    this.openMs = Math.round(performance.now() - t0);
    this.status = 'ready';
    this.location = engine.getLocation();
    const s = await speed;
    if (s) this.speed = s;
    void this.#afterOpen(handle);
  }

  async #source(signal: AbortSignal): Promise<[BookSource, EngineKind]> {
    const b = this.book;
    if (b.format === 'image' && b.path) {
      const files = await core.listImageFolder(b.path);
      if (files.length) {
        this.#imageNames = files.map(baseName);
        return [{ kind: 'images', format: 'image', urls: files.map((p) => fileUrl({ path: p })), names: this.#imageNames }, 'comic'];
      }
    }
    const src = b.source;
    if (src.kind !== 'file') return [src, this.kind];
    // The magic bytes decide the engine; a mislabelled file still opens with the right one.
    const sniffed = await sniffSource(src.url, signal).catch((e) => {
      if ((e as { code?: string })?.code === 'NotFound') throw e; // the file is gone: say so
      return null;
    });
    const format = sniffed?.format ?? src.format;
    return [{ ...src, format }, engineKindFor(format)];
  }

  /** initialLocator (open at a search hit) > saved progress > the opened image > start. */
  startLocator(): Locator | undefined {
    const b = this.book as OpenBook & { initialLocator?: Locator };
    if (b.initialLocator) return b.initialLocator;
    const l = (b.progress as { locator?: Locator } | undefined)?.locator;
    if (l && typeof l === 'object' && (l.kind === 'fixed' || l.kind === 'reflow')) return l;
    const i = b.startImage ? this.#imageNames.indexOf(baseName(b.startImage)) : -1;
    return i > 0 ? { kind: 'fixed', page: i, y: 0 } : undefined;
  }

  /** Metadata, cover, reading session: after the first page is on screen. */
  async #afterOpen(handle: BookHandle): Promise<void> {
    const id = this.book.id;
    if (!isLibraryId(id)) return;
    const m = handle.metadata;
    void quiet(
      core.setBookMetadata(id, {
        pageCount: handle.pageCount ?? null,
        wordCount: handle.wordCount ?? null,
        title: m.title && m.title !== 'Untitled' ? m.title : null,
        author: m.authors.length ? m.authors.join(', ') : null,
        user: false,
      }),
    );
    this.#sessionId = (await quiet(core.startSession(id))) ?? null;
    if (this.needsCover && m.cover) {
      // idle work: never compete with the first pages
      await new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(r, { timeout: 3000 }) : setTimeout(r, 800)));
      if (this.#disposed) return;
      const blob = await quiet(m.cover());
      const bytes = blob ? await quiet(coverBytes(blob)) : undefined;
      if (bytes && !this.#disposed) await quiet(raw.saveCover(id, bytes));
    }
  }

  #wire(e: Extras): void {
    this.#offs.push(
      e.on('relocated', (ev) => this.#onRelocated(ev)),
      e.on('presentationchange', (p) => {
        if (typeof p.zoom === 'number') this.zoom = p.zoom;
        // the engine moved to a custom zoom by itself (Ctrl+wheel, pinch): remember it per book
        if (p.fit === 'custom' && typeof p.zoom === 'number') {
          this.#applied.fit = JSON.stringify('custom');
          this.#applied.zoom = JSON.stringify(p.zoom);
          if (this.bookSettings.fit !== 'custom' || Math.abs((this.bookSettings.zoom ?? 0) - p.zoom) > 1e-3) this.setBookSetting({ fit: 'custom', zoom: p.zoom });
        }
      }),
      e.on('selection', (s) => {
        this.selection = s;
        for (const f of [...this.#selectionSubs]) f(s);
      }),
      e.on('link', (l) => {
        if (l.external) return; // opened by the external-link handler (pdf) or ReaderView (reflow)
        const here = this.location?.locator;
        if (here) this.#pushHistory(here);
      }),
    );
  }

  #onRelocated(ev: RelocatedEvent): void {
    this.location = ev;
    const l = ev.locator;
    if (l.kind === 'fixed') this.#seenPages.add(l.page);
    const f = ev.progress.fraction;
    if (this.#lastFraction != null && this.handle?.wordCount) {
      const d = f - this.#lastFraction;
      if (d > 0 && d < 0.05) this.#wordsRead += d * this.handle.wordCount; // jumps don't count as reading
    }
    this.#lastFraction = f;
    // 'initial' is where we just restored to: never overwrite the saved place with it. Reflow re-layout echoes arrive
    // already settled (the engine publishes them once the layout holds still), so every other reason is a real position.
    if (ev.reason === 'initial') return;
    this.#saver.update(l, f);
  }

  // ---- navigation ------------------------------------------------------------------------

  #pushHistory(from: Locator): void {
    this.history.push($state.snapshot(from) as Locator);
    this.historyRev++;
  }

  /** A jump (TOC, go-to, search hit, start/end): remembered in history. */
  async jump(to: Locator | { fraction: number }, remember = true): Promise<void> {
    const e = this.engine;
    if (!e) return;
    const here = this.location?.locator;
    if (remember && here && !('kind' in to && samePlace(here, to))) this.#pushHistory(here);
    if ('kind' in to) await e.goTo(to);
    else await e.goToFraction(to.fraction);
  }

  async back(): Promise<boolean> {
    const to = this.history.goBack(this.location?.locator ?? null);
    this.historyRev++;
    if (!to || !this.engine) return false;
    await this.engine.goTo(to);
    return true;
  }

  async forward(): Promise<boolean> {
    const to = this.history.goForward(this.location?.locator ?? null);
    this.historyRev++;
    if (!to || !this.engine) return false;
    await this.engine.goTo(to);
    return true;
  }

  // ---- slots for annotations (T11) and speech (T13) -------------------------------------

  /** Selection pipeline: called with the engine selection (anchor, text, rects in stage space) or null. */
  onSelection(fn: (s: EngineSelection | null) => void): () => void {
    this.#selectionSubs.add(fn);
    return () => this.#selectionSubs.delete(fn);
  }

  decorate(layer: DecorationLayer, items: Decoration[]): void {
    this.engine?.setDecorations(layer, items);
  }

  anchorForSelection(): Promise<Anchor | null> {
    return this.engine?.selectionToAnchor() ?? Promise.resolve(null);
  }

  // ---- close -----------------------------------------------------------------------------

  /** Write the pending position now (blur, hide, close). */
  flush(): Promise<void> {
    void this.#flushSettings();
    return this.#saver.flush();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#abort.abort();
    // last known position, even if the debounce never fired
    // fixed: the live scroll position; reflow: every real move already went through the saver (see #onRelocated)
    const loc = this.kind === 'reflow' ? null : this.engine?.getLocation();
    if (loc && this.status === 'ready' && !this.#saver.pending && loc.reason !== 'initial') this.#saver.update(loc.locator, loc.progress.fraction);
    void this.flush();
    if (this.#sessionId != null) {
      const words = Math.round(this.#wordsRead);
      const pages = Math.max(0, this.#seenPages.size - 1);
      const unit = this.handle?.layout === 'reflowable' ? 'words' : 'pages';
      void quiet(core.endSession(this.#sessionId, unit === 'words' ? words : pages, unit));
    }
    this.#offs.forEach((f) => f());
    this.#selectionSubs.clear();
    try {
      this.engine?.dispose();
    } catch (e) {
      console.warn('[reader] engine dispose failed', e);
    }
    this.engine = null;
  }
}

/** A cover thumbnail (WebP, ≤ 480 px wide) from the engine's cover blob. */
async function coverBytes(blob: Blob): Promise<Uint8Array> {
  const bm = await createImageBitmap(blob);
  const w = Math.min(480, bm.width);
  const h = Math.round((bm.height * w) / bm.width);
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.drawImage(bm, 0, 0, w, h);
  bm.close();
  const out = await c.convertToBlob({ type: 'image/webp', quality: 0.85 });
  return new Uint8Array(await out.arrayBuffer());
}
