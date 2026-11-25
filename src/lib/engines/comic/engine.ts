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
  type Rect,
  type ReadingDirection,
  type RelocatedEvent,
  type ResolvedAnchor,
  type SearchHit,
  type SearchOptions,
  type Spread,
  type TextChunk,
  type TextRange,
  type TextStreamOptions,
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
import { anchorFor, findQuote, quadsFor, rotateBox, wordStarts, wordText, wordsInRange, type Quad, type Rotation } from './ocr';
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
  rotation: Rotation;
}

const STYLE_ID = 'q-comic-style';
const CSS = `
.q-pg>.q-deco,.q-pg>.q-ocr{position:absolute;inset:0;pointer-events:none}
.q-pg>.q-deco{z-index:1}
.q-pg>.q-ocr{z-index:2}
.q-ocr ::selection{background:var(--q-selection)}
.q-ocr span{position:absolute;color:transparent;white-space:pre;user-select:text;-webkit-user-select:text;pointer-events:auto;cursor:text;overflow:visible;line-height:1}
.q-d{position:absolute;box-sizing:border-box;border-radius:2px}
.q-d-underline{background:none!important;border-bottom:2px solid var(--c)}
.q-d-note{border-right:3px solid var(--c)}
.q-d-current{outline:2px solid var(--q-accent);outline-offset:1px}
.q-d-bookmark{width:12px!important;height:20px!important;left:auto!important;right:10px;background:var(--q-accent);clip-path:polygon(0 0,100% 0,100% 100%,50% 75%,0 100%)}
`;

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
  private handle: BookHandle | null = null;
  private readonly listeners = new Map<keyof EngineEventMap, Set<(e: never) => void>>();
  private readonly painter = new Painter();
  private pres: ComicPresentation = { theme: DEFAULT_THEME, pageTint: 'original', flow: 'paginated', spread: 'single', zoom: 1, fit: 'page', direction: 'ltr', rotation: 0 };
  private directionChosen = false;
  private decos: Record<DecorationLayer, Decoration[]> = { annotations: [], search: [], speech: [] };
  private selection: EngineSelection | null = null;
  private selAbort: AbortController | null = null;
  private selTimer = 0;
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
    // The handle (and its capabilities) is kept so OCR results can switch search/textStream on later.
    return (this.handle = {
      metadata,
      toc,
      layout: 'fixed' as LayoutKind,
      hasText: false,
      pageCount: this.count,
      capabilities: { selection: false, search: false, textStream: false, thumbnails: true, typography: false, zoom: true, pageTint: true, spreads: true, flows: true, ocr: true },
    });
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
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.append(st);
    }
    this.selAbort = new AbortController();
    document.addEventListener('selectionchange', () => this.onSelectionChange(), { signal: this.selAbort.signal });
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
    this.selAbort?.abort();
    this.selAbort = null;
    clearTimeout(this.selTimer);
    this.selection = null;
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
    if (p.rotation !== undefined && [0, 90, 180, 270].includes(p.rotation)) n.rotation = p.rotation;
    if (!this.root || !this.view) return;
    if (n.flow !== before.flow) {
      const l = this.last?.locator;
      const at = l?.kind === 'fixed' ? l : { page: this.view.page, y: 0 };
      this.rebuilding = this.rebuilding.then(() => this.buildView(at.page, at.y ?? 0, 'presentation')).catch((e) => this.emit('warning', toError(e)));
      return;
    }
    if (n.theme !== before.theme) this.applyBackground();
    if (n.theme !== before.theme || n.pageTint !== before.pageTint) this.view.repaint();
    if (n.spread !== before.spread || n.fit !== before.fit || n.zoom !== before.zoom || n.direction !== before.direction || n.rotation !== before.rotation) this.view.relayout();
    if (n.rotation !== before.rotation) this.redraw(['ocr', 'deco']);
    else if (n.theme !== before.theme) this.redraw(['deco']);
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
    if (!this.root) return;
    this.root.style.background = this.pres.theme.bg;
    this.root.style.setProperty('--q-selection', this.pres.theme.selection);
    this.root.style.setProperty('--q-accent', this.pres.theme.accent);
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
    if (!old || old.w !== bm.width || old.h !== bm.height) this.redraw(['ocr', 'deco'], page);
    return bm;
  }

  private readonly host: ViewHost = {
    count: 0,
    painter: this.painter,
    settings: () => ({ rotation: this.rot(), fit: this.pres.fit, zoom: this.pres.zoom, spread: this.pres.spread, direction: this.pres.direction, gap: this.gap, tint: this.tint() }),
    dims: (i) => {
      const d = this.dimsArr[i];
      return d && this.rot() % 180 ? { w: d.h, h: d.w } : d;
    },
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
    pointer: (ev) => {
      const hit = this.hitDecoration(ev.x, ev.y);
      if (hit) this.emit('decorationclick', hit);
      else this.emit('pointer', ev);
    },
    mounted: (page, box) => {
      box.insertAdjacentHTML('beforeend', '<div class="q-deco"></div><div class="q-ocr"></div>');
      this.drawDeco(box);
      this.drawOcr(box);
    },
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

  /** OCR text of a page: its words joined by spaces (empty when the page has no OCR). */
  private ocrText(page: number): string {
    return (this.ocr.get(page) ?? []).map((w) => w.text).join(' ');
  }

  /** Searches the OCR text only (comics have no other). Hits carry word quads (image pixels) so the `search` layer can draw them. */
  async *search(query: string, options: SearchOptions = {}): AsyncGenerator<SearchHit> {
    const q = options.caseSensitive ? query.trim() : query.trim().toLowerCase();
    if (!q) return;
    for (const page of [...this.ocr.keys()].sort((a, b) => a - b)) {
      if (options.signal?.aborted || this.disposed) return;
      const text = this.ocrText(page);
      const hay = options.caseSensitive ? text : text.toLowerCase();
      for (let at = hay.indexOf(q); at >= 0; at = hay.indexOf(q, at + q.length)) {
        const end = at + q.length;
        if (options.wholeWord && (/\w/.test(hay[at - 1] ?? '') || /\w/.test(hay[end] ?? ''))) continue;
        const ws = this.ocr.get(page)!;
        const r = wordsInRange(ws, at, end);
        const found = r ? anchorFor(page, ws, r[0], r[1], this.dimsArr[page]?.h ?? 0) : null;
        const locator: Locator = found?.locator ?? { kind: 'fixed', page, y: 0 };
        yield {
          locator,
          excerpt: { before: text.slice(Math.max(0, at - 40), at), match: text.slice(at, end), after: text.slice(end, end + 40) },
          anchor: { locator, quote: { exact: text.slice(at, end), prefix: text.slice(Math.max(0, at - 32), at), suffix: text.slice(end, end + 32) }, pdfQuads: found?.pdfQuads },
        };
      }
    }
  }

  async getText(range: TextRange): Promise<string> {
    const a = range.from.kind === 'fixed' ? range.from.page : 0;
    const b = range.to.kind === 'fixed' ? range.to.page : this.count - 1;
    const parts: string[] = [];
    for (let p = Math.max(0, a); p <= Math.min(this.count - 1, b); p++) if (this.ocr.has(p)) parts.push(this.ocrText(p));
    return parts.join('\n');
  }

  /** One chunk per OCR'd page (reading order = page order). */
  async *textStream(from?: Locator, options: TextStreamOptions = {}): AsyncGenerator<TextChunk> {
    const start = from?.kind === 'fixed' ? from.page : 0;
    for (const page of [...this.ocr.keys()].sort((a, b) => a - b)) {
      if (page < start) continue;
      if (options.signal?.aborted || this.disposed) return;
      const text = this.ocrText(page);
      if (!text) continue;
      const locator: Locator = { kind: 'fixed', page, y: 0 };
      yield {
        text,
        locator,
        end: { kind: 'fixed', page, y: 1 },
        anchorFor: async (s, e) => {
          const ws = this.ocr.get(page);
          const r = ws && wordsInRange(ws, s, e);
          const a = ws && r ? anchorFor(page, ws, r[0], r[1], this.dimsArr[page]?.h ?? 0) : null;
          return { locator: a?.locator ?? locator, quote: { exact: text.slice(s, e), prefix: text.slice(Math.max(0, s - 32), s), suffix: text.slice(e, e + 32) }, pdfQuads: a?.pdfQuads };
        },
      };
    }
  }

  // ---- selection ------------------------------------------------------------------------------

  private onSelectionChange(): void {
    clearTimeout(this.selTimer);
    this.selTimer = window.setTimeout(() => {
      const sel = window.getSelection();
      const inside = !!sel && sel.rangeCount > 0 && !sel.isCollapsed && !!this.root?.contains(sel.anchorNode) && !!this.root.contains(sel.focusNode);
      const next = inside ? this.buildSelection(sel!.getRangeAt(0)) : null;
      if (!next && !this.selection) return;
      this.selection = next;
      this.emit('selection', next);
    }, 120);
  }

  /** The OCR words covered by `range` on the page where it starts, as an anchor plus on-screen rects (target space). */
  private buildSelection(range: Range): EngineSelection | null {
    const start = range.startContainer;
    const box = (start instanceof Element ? start : start.parentElement)?.closest<HTMLElement>('.q-pg');
    const words = box && this.ocr.get(Number(box.dataset.page));
    if (!box || !words || !this.root) return null;
    const idx = [...box.querySelectorAll<HTMLElement>('.q-ocr span')].filter((s) => range.intersectsNode(s)).map((s) => Number(s.dataset.i));
    if (!idx.length) return null;
    const page = Number(box.dataset.page);
    const t = this.root.getBoundingClientRect();
    const pb = box.getBoundingClientRect();
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 0 && r.height > 0 && r.left + r.width / 2 >= pb.left && r.left + r.width / 2 <= pb.right && r.top + r.height / 2 >= pb.top && r.top + r.height / 2 <= pb.bottom)
      .map((r) => ({ x: r.left - t.left, y: r.top - t.top, width: r.width, height: r.height }));
    const anchor = anchorFor(page, words, Math.min(...idx), Math.max(...idx), this.dimsArr[page]?.h ?? 0);
    return { anchor, text: anchor.quote.exact, rects };
  }

  async selectionToAnchor(selection?: Selection | null): Promise<Anchor | null> {
    const sel = selection ?? window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !this.root?.contains(sel.anchorNode)) return null;
    return this.buildSelection(sel.getRangeAt(0))?.anchor ?? null;
  }
  getSelection(): EngineSelection | null {
    return this.selection;
  }
  clearSelection(): void {
    window.getSelection()?.removeAllRanges();
    if (this.selection) {
      this.selection = null;
      this.emit('selection', null);
    }
  }

  /** Page-level anchor (bookmarks): the page, no quote. */
  pageAnchor(page = this.view?.page ?? 0): Anchor {
    return { locator: { kind: 'fixed', page, y: 0 }, quote: { exact: '', prefix: '', suffix: '' } };
  }

  /** Word quads for an anchor: stored quads, else its quote found in the OCR text of the page (or a neighbour). */
  private resolve(a: Anchor, wide: boolean): { page: number; quads: Quad[]; exact: boolean; updated?: Anchor } | null {
    if (a.locator.kind !== 'fixed') return null;
    const home = a.locator.page;
    if (a.pdfQuads?.length) return { page: home, quads: a.pdfQuads, exact: true };
    for (const page of wide ? [home, home + 1, home - 1, home + 2, home - 2] : [home]) {
      const ws = this.ocr.get(page);
      const at = ws ? findQuote(wordText(ws), a.quote) : -1;
      const r = ws && at >= 0 ? wordsInRange(ws, at, at + a.quote.exact.length) : null;
      if (!ws || !r) continue;
      const found = anchorFor(page, ws, r[0], r[1], this.dimsArr[page]?.h ?? 0);
      return { page, quads: found.pdfQuads!, exact: page === home, updated: page === home ? undefined : found };
    }
    return null;
  }

  async anchorToRanges(anchor: Anchor): Promise<ResolvedAnchor | null> {
    const l = anchor.locator;
    if (l.kind !== 'fixed' || l.page < 0 || l.page >= this.count) return null;
    const r = this.resolve(anchor, true);
    if (!r) return { regions: [{ page: l.page, rects: [] }], exact: true };
    const t = this.root?.getBoundingClientRect();
    const box = this.root?.querySelector<HTMLElement>(`.q-pg[data-page="${r.page}"]`);
    const f = this.frame(r.page);
    let rects: Rect[] = [];
    if (box && t && f) {
      const b = box.getBoundingClientRect();
      rects = r.quads.map((q) => {
        const [x, y, w, h] = rotateBox(f.rot, f.W, f.H, q) as [number, number, number, number];
        return { x: b.left - t.left + (x / f.Wr) * b.width, y: b.top - t.top + (y / f.Hr) * b.height, width: (w / f.Wr) * b.width, height: (h / f.Hr) * b.height };
      });
    }
    return { regions: [{ page: r.page, rects }], exact: r.exact, updated: r.updated };
  }

  // ---- decorations and the OCR layer ------------------------------------------------------------

  setDecorations(layer: DecorationLayer, items: Decoration[]): void {
    this.decos[layer] = items;
    this.redraw(['deco']);
  }

  private rot(): Rotation {
    return this.pres.flow === 'scrolled' ? 0 : this.pres.rotation;
  }

  /** Raw (image) and displayed (rotated) size of a page; null until it has decoded. */
  private frame(page: number): { W: number; H: number; Wr: number; Hr: number; rot: Rotation } | null {
    const d = this.dimsArr[page];
    if (!d) return null;
    const rot = this.rot();
    const sw = rot % 180 !== 0;
    return { W: d.w, H: d.h, Wr: sw ? d.h : d.w, Hr: sw ? d.w : d.h, rot };
  }

  /** Image-pixel quad -> percentage box of the displayed page (survives zoom without redrawing). */
  private pct(f: NonNullable<ReturnType<ComicEngine['frame']>>, q: Quad): { left: number; top: number; width: number; height: number } {
    const [x, y, w, h] = rotateBox(f.rot, f.W, f.H, q) as [number, number, number, number];
    return { left: (x / f.Wr) * 100, top: (y / f.Hr) * 100, width: (w / f.Wr) * 100, height: (h / f.Hr) * 100 };
  }

  /** Redraw the OCR and/or decoration layers of the shown pages (all, or just `only`). */
  private redraw(kinds: ('ocr' | 'deco')[], only?: number): void {
    if (!this.root) return;
    for (const box of this.root.querySelectorAll<HTMLElement>('.q-pg')) {
      if (only !== undefined && Number(box.dataset.page) !== only) continue;
      if (kinds.includes('deco')) this.drawDeco(box);
      if (kinds.includes('ocr')) this.drawOcr(box);
    }
  }

  /** Transparent positioned spans (like pdf.js' text layer) so the browser's own selection, copy and drag work on OCR'd pages. */
  private drawOcr(box: HTMLElement): void {
    const layer = box.querySelector('.q-ocr');
    const page = Number(box.dataset.page);
    const words = this.ocr.get(page);
    const f = this.frame(page);
    if (!layer) return;
    layer.replaceChildren();
    if (!words?.length || !f) return;
    const frag = document.createDocumentFragment();
    words.forEach((w, i) => {
      const b = this.pct(f, [w.x, w.y, w.width, w.height]);
      const s = document.createElement('span');
      s.textContent = `${w.text} `;
      s.dataset.i = String(i);
      s.style.cssText = `left:${b.left}%;top:${b.top}%;width:${b.width}%;height:${b.height}%;font-size:${b.height * 0.85}cqh`;
      frag.append(s);
    });
    layer.append(frag);
  }

  private drawDeco(box: HTMLElement): void {
    const layerEl = box.querySelector('.q-deco');
    const page = Number(box.dataset.page);
    const f = this.frame(page);
    if (!layerEl) return;
    const theme = this.pres.theme;
    const frag = document.createDocumentFragment();
    for (const layer of ['annotations', 'search', 'speech'] as DecorationLayer[]) {
      for (const d of this.decos[layer]) {
        if (!f || d.anchor.locator.kind !== 'fixed' || d.anchor.locator.page !== page) continue;
        const res = this.resolve(d.anchor, false);
        if (!res) continue;
        const style = d.style;
        const color = 'color' in style ? theme.highlight[style.color] : theme.accent;
        for (const q of res.quads) {
          const b = this.pct(f, q);
          const el = document.createElement('div');
          el.className = `q-d q-d-${style.type}`;
          el.dataset.deco = d.id;
          el.dataset.layer = layer;
          el.style.cssText = `left:${b.left}%;top:${b.top}%;width:${b.width}%;height:${b.height}%;--c:${color};`;
          switch (style.type) {
            case 'highlight': case 'note': el.style.background = `color-mix(in srgb, ${color} 42%, transparent)`; break;
            case 'search-hit': el.style.background = `color-mix(in srgb, ${theme.highlight[0]} ${style.current ? 85 : 55}%, transparent)`; if (style.current) el.classList.add('q-d-current'); break;
            case 'speech-word': el.style.background = `color-mix(in srgb, ${theme.accent} 45%, transparent)`; break;
            case 'speech-sentence': el.style.background = `color-mix(in srgb, ${theme.accent} 16%, transparent)`; break;
          }
          frag.append(el);
          if (style.type === 'bookmark') break;
        }
      }
    }
    layerEl.replaceChildren(frag);
  }

  /** The smallest drawn annotation under a click (root-relative px), as a `decorationclick` payload. */
  private hitDecoration(x: number, y: number): EngineEventMap['decorationclick'] | null {
    const root = this.root;
    if (!root) return null;
    const rr = root.getBoundingClientRect();
    let best: { el: HTMLElement; area: number } | null = null;
    for (const el of root.querySelectorAll<HTMLElement>('.q-d[data-layer="annotations"]:not(.q-d-bookmark)')) {
      const r = el.getBoundingClientRect();
      if (x + rr.left < r.left || x + rr.left > r.right || y + rr.top < r.top || y + rr.top > r.bottom) continue;
      if (!best || r.width * r.height < best.area) best = { el, area: r.width * r.height };
    }
    if (!best) return null;
    const r = best.el.getBoundingClientRect();
    return { layer: 'annotations', id: best.el.dataset.deco!, rect: { x: r.left - rr.left, y: r.top - rr.top, width: r.width, height: r.height } };
  }

  /**
   * Hook for a synthetic text layer (OCR, T12). Words are in image pixels of the page, origin top-left.
   * Stored per page, searchable / streamable (`search`, `getText`, `textStream`), and drawn as an invisible
   * selectable text layer with decorations (highlights, search hits, speech word) over the page.
   */
  setTextLayer(page: number, words: OcrWord[]): void {
    if (words.length) this.ocr.set(page, words);
    else this.ocr.delete(page);
    if (this.handle) {
      this.handle.hasText = this.ocr.size > 0;
      this.handle.capabilities.search = this.handle.capabilities.textStream = this.handle.capabilities.selection = this.ocr.size > 0;
    }
    this.redraw(['ocr', 'deco'], page);
  }
  /** Words are in decoded-image pixels (see `setTextLayer`), unrotated. */
  async ocrPageSize(page: number): Promise<{ width: number; height: number; rotate: 0 }> {
    const bm = await this.bitmap(page);
    return { width: bm.width, height: bm.height, rotate: 0 };
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
