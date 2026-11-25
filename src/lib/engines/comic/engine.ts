/**
 * Comic & Image Engine: CBZ, CBR (+ anything libarchive reads), image folders, single images, SVG.
 * Pages decode with createImageBitmap into a byte-bounded LRU, the next three pages and one behind
 * are preloaded, and a page turn from cache draws synchronously.
 */
import {
  EngineError,
  type Anchor,
  type BookHandle,
  type BookMetadata,
  type BookSource,
  type Decoration,
  type DecorationLayer,
  type Engine,
  type EngineEventHandler,
  type EngineEventMap,
  type EngineSelection,
  type Fit,
  type Flow,
  type LayoutKind,
  type Locator,
  type OcrWord,
  type OpenOptions,
  type PageTint,
  type Presentation,
  type ReadingDirection,
  type RelocatedEvent,
  type ResolvedAnchor,
  type SearchHit,
  type Spread,
  type TextChunk,
  type TextRange,
  type Theme,
  type TocEntry,
} from '../types';
import { ByteLru } from '../pdf/lru';
import { parseCssColor } from '../pdf/tint';
import { parseComicInfo, type ComicInfo } from './comicinfo';
import { decodeBlob, decodeThumbnail, placeholderBitmap } from './decode';
import type { PageView, ViewHost } from './host';
import { bindInteraction } from './interact';
import { clamp, type Size } from './layout';
import { PagedView } from './paged';
import { baseName, stripExt } from './pages';
import { Painter, type TintState } from './painter';
import { openSource, type PageSource } from './sources';
import { WebtoonView } from './webtoon';

/** Decoded-bitmap budget (RGBA bytes). ~40 typical pages. */
const CACHE_BYTES = 320 * 1024 * 1024;

const DEFAULT_THEME: Theme = {
  id: 'comic-default',
  name: 'Default',
  dark: true,
  bg: '#1e1f22',
  surface: '#16171a',
  text: '#d8d8d0',
  muted: '#9a9a92',
  accent: '#7aa2f7',
  link: '#7aa2f7',
  selection: 'rgb(122 162 247 / 0.35)',
  highlight: ['#e5c07b', '#98c379', '#61afef', '#e06c9f'],
  shadow: 'rgb(0 0 0 / 0.5)',
};

interface ComicPresentation {
  theme: Theme;
  pageTint: PageTint;
  flow: Flow;
  spread: Spread;
  zoom: number;
  fit: Fit;
  direction: ReadingDirection;
}

export class ComicEngine implements Engine {
  readonly kind = 'comic' as const;

  private src: PageSource | null = null;
  private count = 0;
  private names: string[] = [];
  private info: ComicInfo | null = null;
  private chapters: { title: string; page: number }[] = [];
  private dimsArr: (Size | undefined)[] = [];
  private readonly cache = new ByteLru<number, ImageBitmap>(CACHE_BYTES, (_k, b) => b.close());
  private readonly inflight = new Map<number, Promise<ImageBitmap>>();
  private readonly warned = new Set<number>();
  private readonly ocr = new Map<number, OcrWord[]>();
  private readonly listeners = new Map<keyof EngineEventMap, Set<(e: never) => void>>();
  private readonly painter = new Painter();
  private pres: ComicPresentation = { theme: DEFAULT_THEME, pageTint: 'original', flow: 'paginated', spread: 'single', zoom: 1, fit: 'page', direction: 'ltr' };
  private directionChosen = false;
  private gap = 6;
  private tintCache: { theme: Theme; mode: PageTint; state: TintState } | null = null;

  private root: HTMLElement | null = null;
  private view: PageView | null = null;
  private ro: ResizeObserver | null = null;
  private unbind: (() => void) | null = null;
  private resizeRaf = 0;
  private last: RelocatedEvent | null = null;
  private disposed = false;
  private rebuilding: Promise<void> = Promise.resolve();

  // ---- open -----------------------------------------------------------------------------------

  async open(source: BookSource, options: OpenOptions = {}): Promise<BookHandle> {
    if (this.src) throw new EngineError('unknown', 'This engine instance is already open');
    let src: PageSource;
    try {
      src = await openSource(source, options);
    } catch (e) {
      throw e instanceof EngineError ? e : new EngineError('corrupt', 'This comic could not be opened.', { cause: e });
    }
    if (options.signal?.aborted || this.disposed) {
      src.close();
      throw new EngineError('aborted');
    }
    this.src = src;
    this.names = src.names;
    this.count = this.host.count = src.names.length;
    this.info = src.comicInfo ? parseComicInfo(src.comicInfo) : null;
    this.dimsArr = new Array(this.count);
    for (const p of this.info?.pages ?? []) if (p.width && p.height && p.image < this.count) this.dimsArr[p.image] = { w: p.width, h: p.height };
    if (this.info?.rtl && !this.directionChosen) this.pres.direction = 'rtl';
    this.chapters = (this.info?.pages ?? [])
      .filter((p) => p.bookmark && p.image < this.count)
      .sort((a, b) => a.image - b.image)
      .map((p) => ({ title: p.bookmark!, page: p.image }));

    const fileName = source.kind === 'file' ? (source.fileName ?? fileNameFromUrl(source.url)) : undefined;
    const i = this.info;
    const metadata: BookMetadata = {
      title: i?.title ?? (i?.series ? `${i.series}${i.number ? ` #${i.number}` : ''}` : stripExt(fileName ?? this.names[0] ?? 'Images')),
      authors: i?.writer ? [i.writer] : [],
      language: i?.language,
      publisher: i?.publisher,
      description: i?.summary,
      published: i?.year ? String(i.year) : undefined,
      series: i?.series ? { name: i.series, index: Number(i.number) || undefined } : undefined,
      direction: i?.rtl ? 'rtl' : undefined,
      cover: () => this.cover(),
    };
    const toc: TocEntry[] = this.chapters.map((c) => ({ title: c.title, locator: { kind: 'fixed', page: c.page, y: 0 }, children: [] }));
    return {
      metadata,
      toc,
      layout: 'fixed' as LayoutKind,
      hasText: false,
      pageCount: this.count,
      capabilities: { selection: false, search: false, textStream: false, thumbnails: true, typography: false, zoom: true, pageTint: true, spreads: true, flows: true, ocr: true },
    };
  }

  // ---- render ---------------------------------------------------------------------------------

  async render(target: HTMLElement, locator?: Locator): Promise<void> {
    if (!this.src) throw new EngineError('unknown', 'open() must finish before render()');
    this.teardownView();
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    const root = document.createElement('div');
    root.className = 'q-comic';
    root.style.cssText = 'position:absolute;inset:0;overflow:hidden;user-select:none;-webkit-user-select:none;';
    target.append(root);
    this.root = root;
    this.applyBackground();
    this.unbind = bindInteraction(root, () => this.view, this.host);
    this.ro = new ResizeObserver(() => {
      this.resizeRaf ||= requestAnimationFrame(() => {
        this.resizeRaf = 0;
        this.view?.relayout();
      });
    });
    this.ro.observe(root);
    const start = locator?.kind === 'fixed' ? { page: locator.page, y: locator.y ?? 0 } : this.last?.locator.kind === 'fixed' ? { page: this.last.locator.page, y: this.last.locator.y ?? 0 } : { page: 0, y: 0 };
    await this.buildView(start.page, start.y, 'initial');
  }

  private async buildView(page: number, y: number, reason: RelocatedEvent['reason']): Promise<void> {
    if (!this.root || !this.count) return;
    this.view?.dispose();
    page = clamp(Math.round(page), 0, this.count - 1);
    if (this.pres.flow === 'scrolled') {
      this.view = new WebtoonView(this.host, this.root, { page, y });
      await this.view.goTo(page, y, reason);
    } else {
      const v = new PagedView(this.host, this.root);
      this.view = v;
      await v.goTo(page, y, reason);
    }
  }

  private teardownView(): void {
    this.view?.dispose();
    this.view = null;
    this.unbind?.();
    this.ro?.disconnect();
    cancelAnimationFrame(this.resizeRaf);
    this.resizeRaf = 0;
    this.root?.remove();
    this.root = null;
  }

  // ---- navigation -----------------------------------------------------------------------------

  async goTo(locator: Locator): Promise<void> {
    if (locator.kind !== 'fixed') return;
    if (!this.view) throw new EngineError('not-rendered');
    await this.view.goTo(locator.page, locator.y ?? 0, 'navigation');
  }

  async goToFraction(fraction: number): Promise<void> {
    if (!this.view) throw new EngineError('not-rendered');
    const f = clamp(fraction, 0, 1) * this.count;
    const page = Math.min(this.count - 1, Math.floor(f));
    await this.view.goTo(page, f - page, 'navigation');
  }

  next(): Promise<boolean> {
    if (!this.view) return Promise.reject(new EngineError('not-rendered'));
    return this.view.next();
  }

  prev(): Promise<boolean> {
    if (!this.view) return Promise.reject(new EngineError('not-rendered'));
    return this.view.prev();
  }

  /** `comic.left` / `comic.right`: toward the side the user pressed, honouring reading direction. */
  turnToward(side: 'left' | 'right'): Promise<boolean> {
    const forward = (side === 'right') === (this.pres.direction === 'ltr');
    return forward ? this.next() : this.prev();
  }

  scrollBy(dy: number): void {
    this.view?.scrollBy(dy);
  }

  getLocation(): RelocatedEvent | null {
    return this.last;
  }

  // ---- presentation ---------------------------------------------------------------------------

  on<K extends keyof EngineEventMap>(type: K, handler: EngineEventHandler<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(handler as (e: never) => void);
    return () => set!.delete(handler as (e: never) => void);
  }

  private emit<K extends keyof EngineEventMap>(type: K, event: EngineEventMap[K]): void {
    for (const h of [...(this.listeners.get(type) ?? [])]) {
      try {
        (h as (e: EngineEventMap[K]) => void)(event);
      } catch (e) {
        console.error(`comic engine: ${type} handler threw`, e);
      }
    }
  }

  setPresentation(p: Partial<Presentation>): void {
    const before = { ...this.pres };
    const n = this.pres;
    if (p.theme) n.theme = p.theme;
    if (p.pageTint) n.pageTint = p.pageTint;
    if (p.flow) n.flow = p.flow;
    if (p.spread) n.spread = p.spread;
    if (p.fit) n.fit = p.fit;
    if (p.zoom !== undefined && Number.isFinite(p.zoom)) n.zoom = clamp(p.zoom, 0.05, 8);
    if (p.direction) {
      n.direction = p.direction;
      this.directionChosen = true;
    }
    if (!this.root || !this.view) return;
    if (n.flow !== before.flow) {
      const l = this.last?.locator;
      const at = l?.kind === 'fixed' ? l : { page: this.view.page, y: 0 };
      this.rebuilding = this.rebuilding.then(() => this.buildView(at.page, at.y ?? 0, 'presentation')).catch((e) => this.emit('warning', toError(e)));
      return;
    }
    if (n.theme !== before.theme) this.applyBackground();
    if (n.theme !== before.theme || n.pageTint !== before.pageTint) this.view.repaint();
    if (n.spread !== before.spread || n.fit !== before.fit || n.zoom !== before.zoom || n.direction !== before.direction) this.view.relayout();
  }

  getPresentation(): Readonly<ComicPresentation> {
    return { ...this.pres };
  }

  get direction(): ReadingDirection {
    return this.pres.direction;
  }

  /** Webtoon gap between pages in px (0 = seamless strip). */
  setWebtoonGap(px: number): void {
    this.gap = Math.max(0, px);
    if (this.pres.flow === 'scrolled') this.view?.relayout();
  }

  /** Zoom by `factor` around the viewport centre (toolbar +/- buttons). */
  zoomBy(factor: number): void {
    const r = this.root?.getBoundingClientRect();
    if (r) this.view?.zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  private applyBackground(): void {
    if (this.root) this.root.style.background = this.pres.theme.bg;
  }

  private tint(): TintState {
    const c = this.tintCache;
    if (c && c.theme === this.pres.theme && c.mode === this.pres.pageTint) return c.state;
    const state: TintState = { mode: this.pres.pageTint, bg: parseCssColor(this.pres.theme.bg), fg: parseCssColor(this.pres.theme.text) };
    this.tintCache = { theme: this.pres.theme, mode: this.pres.pageTint, state };
    return state;
  }

  // ---- decode + cache -------------------------------------------------------------------------

  /** Resolve a page to a live bitmap. A page that fails to decode becomes a placeholder (and a `warning` event). */
  private bitmap(page: number): Promise<ImageBitmap> {
    const hit = this.cache.get(page);
    if (hit && hit.width > 0) return Promise.resolve(hit);
    let p = this.inflight.get(page);
    if (!p) {
      p = this.decodePage(page).finally(() => this.inflight.delete(page));
      this.inflight.set(page, p);
    }
    return p;
  }

  private async decodePage(page: number): Promise<ImageBitmap> {
    let bm: ImageBitmap;
    try {
      bm = await decodeBlob(await this.src!.load(page), this.names[page] ?? '');
    } catch (e) {
      if (!this.disposed && !this.warned.has(page)) {
        this.warned.add(page);
        this.emit('warning', toError(e));
      }
      bm = await placeholderBitmap(`Page ${page + 1} could not be loaded`);
    }
    if (this.disposed) {
      bm.close();
      throw new EngineError('aborted');
    }
    this.cache.set(page, bm, bm.width * bm.height * 4);
    const old = this.dimsArr[page];
    this.dimsArr[page] = { w: bm.width, h: bm.height };
    if (!old || Math.abs(old.h / old.w - bm.height / bm.width) > 0.005) this.view?.onDims(page);
    return bm;
  }

  private readonly host: ViewHost = {
    count: 0,
    painter: this.painter,
    settings: () => ({ fit: this.pres.fit, zoom: this.pres.zoom, spread: this.pres.spread, direction: this.pres.direction, gap: this.gap, tint: this.tint() }),
    dims: (i) => this.dimsArr[i],
    cached: (i) => {
      const b = this.cache.get(i);
      return b && b.width > 0 ? b : undefined;
    },
    bitmaps: async (pages) => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const out = await Promise.all(pages.map((p) => this.bitmap(p)));
          if (out.every((b) => b.width > 0)) return out;
        }
      } catch {
        // disposed mid-flight
      }
      return [];
    },
    preload: (pages) => {
      for (const p of pages) if (p >= 0 && p < this.count && !this.cache.has(p) && !this.inflight.has(p)) this.bitmap(p).catch(() => {});
    },
    reduceMotion: () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    relocated: (page, y, reason) => this.relocated(page, y, reason),
    presentation: (p) => {
      const changed: Partial<Presentation> = {};
      if (p.fit && p.fit !== this.pres.fit) changed.fit = this.pres.fit = p.fit;
      if (p.zoom !== undefined && Math.abs(p.zoom - this.pres.zoom) > 0.001) changed.zoom = this.pres.zoom = p.zoom;
      if (Object.keys(changed).length) this.emit('presentationchange', changed);
    },
    pointer: (ev) => this.emit('pointer', ev),
    layoutChanged: () => this.emit('layout', undefined),
  };

  private relocated(page: number, y: number, reason: RelocatedEvent['reason']): void {
    const prev = this.last?.locator;
    if ((reason === 'scroll' || reason === 'resize') && prev?.kind === 'fixed' && prev.page === page && Math.abs((prev.y ?? 0) - y) < 1e-4) return;
    const ch = this.chapterAt(page);
    const ev: RelocatedEvent = {
      locator: { kind: 'fixed', page, y },
      progress: {
        fraction: this.count ? Math.min(1, (page + clamp(y, 0, 1)) / this.count) : 0,
        chapter: ch ? { index: ch.index, title: ch.title } : undefined,
        page: { index: page, count: this.count, label: String(page + 1) },
      },
      reason,
    };
    this.last = ev;
    this.emit('relocated', ev);
  }

  private chapterAt(page: number): { index: number; title: string } | null {
    let found = -1;
    this.chapters.forEach((c, i) => c.page <= page && (found = i));
    return found >= 0 ? { index: found, title: this.chapters[found]!.title } : null;
  }

  // ---- thumbnails and cover -------------------------------------------------------------------

  thumbnail = async (page: number, maxWidth: number): Promise<ImageBitmap | null> => {
    if (!this.src || page < 0 || page >= this.count || this.disposed) return null;
    try {
      const hit = this.cache.peek(page);
      if (hit && hit.width > 0) {
        const k = Math.min(1, maxWidth / hit.width);
        return await createImageBitmap(hit, { resizeWidth: Math.max(1, Math.round(hit.width * k)), resizeQuality: 'high' });
      }
      return await decodeThumbnail(await this.src.load(page), this.names[page] ?? '', maxWidth);
    } catch (e) {
      this.emit('warning', toError(e));
      return null;
    }
  };
  /** Alias of `thumbnail` (the name used in the task brief). */
  renderThumbnail = this.thumbnail;

  private async cover(): Promise<Blob | null> {
    const bm = await this.thumbnail(0, 480);
    if (!bm) return null;
    const c = new OffscreenCanvas(bm.width, bm.height);
    c.getContext('2d')!.drawImage(bm, 0, 0);
    bm.close();
    return c.convertToBlob({ type: 'image/webp', quality: 0.85 });
  }

  // ---- text: comics have none (OCR can add a synthetic layer) -----------------------------------

  async *search(): AsyncGenerator<SearchHit> {
    /* no text */
  }

  async getText(_range: TextRange): Promise<string> {
    return '';
  }

  async *textStream(): AsyncGenerator<TextChunk> {
    /* no text */
  }

  async selectionToAnchor(): Promise<Anchor | null> {
    return null;
  }
  getSelection(): EngineSelection | null {
    return null;
  }
  clearSelection(): void {}

  /** Page-level anchor (bookmarks): the page, no quote. */
  pageAnchor(page = this.view?.page ?? 0): Anchor {
    return { locator: { kind: 'fixed', page, y: 0 }, quote: { exact: '', prefix: '', suffix: '' } };
  }

  async anchorToRanges(anchor: Anchor): Promise<ResolvedAnchor | null> {
    const l = anchor.locator;
    if (l.kind !== 'fixed' || l.page < 0 || l.page >= this.count) return null;
    return { regions: [{ page: l.page, rects: [] }], exact: true };
  }

  setDecorations(_layer: DecorationLayer, _items: Decoration[]): void {}

  /**
   * Hook for a synthetic text layer (OCR, T12). Words are in image pixels of the page, origin top-left.
   * Stored per page; nothing draws or searches them yet.
   */
  setTextLayer(page: number, words: OcrWord[]): void {
    if (words.length) this.ocr.set(page, words);
    else this.ocr.delete(page);
  }
  setOcrWords = (page: number, words: OcrWord[]): void => this.setTextLayer(page, words);
  getTextLayer(page: number): OcrWord[] | undefined {
    return this.ocr.get(page);
  }

  /** Counters for tests and the dev harness. */
  stats(): Record<string, number> {
    return { cachedPages: this.cache.size, cacheBytes: this.cache.bytes, inflight: this.inflight.size, pages: this.count, ...(this.view?.stats() ?? {}) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardownView();
    this.cache.clear();
    this.inflight.clear();
    this.painter.dispose();
    this.src?.close();
    this.src = null;
    this.listeners.clear();
  }
}

function toError(e: unknown): EngineError {
  return e instanceof EngineError ? e : new EngineError('unknown', (e as Error)?.message, { cause: e });
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url, 'http://x');
    return baseName(decodeURIComponent(u.searchParams.get('path') ?? u.pathname));
  } catch {
    return baseName(url);
  }
}
