import './globals';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { AnnotationLayerBuilder, EventBus, PDFLinkService, TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { EngineError } from '../types';
import type {
  Anchor, AnchorRegion, BookHandle, BookSource, Decoration, DecorationLayer, Engine, EngineEventHandler, EngineEventMap, EngineKind, EngineSelection,
  Locator, OcrWord, OpenOptions, Presentation, Rect, RelocatedEvent, ResolvedAnchor, SearchHit, SearchOptions, TextChunk, TextRange, TextStreamOptions, Theme,
} from '../types';
import { PdfDoc, mapError } from './document';
import { imageRects, rotateNormRect } from './imagerects';
import {
  PAGE_GAP, PDF_TO_CSS, buildRows, clampZoom, computeLayout, fitZoom, fractionOf, locationAt, pctBox, rowAt, scrollTopFor, type Layout, type Size,
} from './layout';
import { ByteLru } from './lru';
import { setupPdfjs } from './setup';
import { GlTinter, INVERT_FILTER, parseCssColor, smartTintImageData, type NormRect, type RGB } from './tint';
import { fuzzyFind, makeQuote, quadsFor, rangeForQuads } from './textindex';

const PAD = 16; // space around the page column when fitting
const BITMAP_BUDGET = 300 * 1024 * 1024;
const MAX_CANVAS_PIXELS = 32e6;
const MAX_ACTIVE_RENDERS = 2;
const ZOOM_SETTLE_MS = 140;

const LIGHT_THEME: Theme = {
  id: 'default-light', name: 'Light', dark: false, bg: '#ffffff', surface: '#f2f2f2', text: '#1a1a1a', muted: '#666666', accent: '#2563eb', link: '#2563eb',
  selection: 'rgb(37 99 235 / 0.3)', highlight: ['#ffd84d', '#7bd88f', '#6cb6ff', '#ff8fb8'], shadow: 'rgb(0 0 0 / 0.25)',
};

const CSS = `
.q-pdf{position:absolute;inset:0;overflow:auto;background:var(--q-surface);color-scheme:var(--q-scheme);overscroll-behavior:contain;scrollbar-gutter:stable;outline:none;
  --scale-factor:1;--user-unit:1;--total-scale-factor:var(--scale-factor)}
.q-pdf.q-snap{scroll-snap-type:y mandatory}
.q-pdf-inner{position:relative}
.q-row{position:absolute;left:0;width:100%;display:flex;justify-content:center;align-items:flex-start;gap:${PAGE_GAP}px;box-sizing:border-box}
.q-snap .q-row{scroll-snap-align:start}
.q-page{position:relative;flex:none;background:var(--q-page-bg);box-shadow:0 1px 3px var(--q-shadow);
  --scale-round-x:1px;--scale-round-y:1px;direction:ltr}
.q-page>canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.q-page>.q-deco,.q-page>.q-ocr{position:absolute;inset:0;pointer-events:none}
.q-page>.q-ocr{z-index:2}
.q-page>.textLayer{z-index:2}
.q-page>.annotationLayer{z-index:3}
.q-page>.q-deco{z-index:1}
.q-page .textLayer ::selection,.q-ocr ::selection{background:var(--q-selection)}
.q-ocr span{position:absolute;color:transparent;white-space:pre;user-select:text;pointer-events:auto;cursor:text;overflow:visible;line-height:1}
.q-d{position:absolute;box-sizing:border-box;border-radius:2px}
.q-d-underline{background:none!important;border-bottom:2px solid var(--c)}
.q-d-note{border-right:3px solid var(--c)}
.q-d-current{outline:2px solid var(--q-accent);outline-offset:1px}
.q-d-bookmark{width:12px!important;height:20px!important;left:auto!important;right:10px;background:var(--q-accent);clip-path:polygon(0 0,100% 0,100% 100%,50% 75%,0 100%)}
`;

type ActiveRender = { key: string; cancel: () => void };

interface PageView {
  i: number;
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  deco: HTMLDivElement;
  ocr: HTMLDivElement;
  proxy?: PDFPageProxy;
  vp1?: PageViewport;
  vp1Rot?: number;
  textB?: TextLayerBuilder;
  annoB?: AnnotationLayerBuilder;
  layerKey?: string;
  layerBusy?: boolean;
  shownKey?: string;
  dead?: boolean;
}

interface RowView {
  el: HTMLDivElement;
  pages: PageView[];
}

type Resolved = { page: number; quads: number[][] } | null;

const isFixed = (l: Locator): l is Extract<Locator, { kind: 'fixed' }> => l.kind === 'fixed';
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export class PdfEngine implements Engine {
  readonly kind: EngineKind = 'pdf';

  private doc?: PdfDoc;
  private handle?: BookHandle;
  private listeners = new Map<keyof EngineEventMap, Set<(e: never) => void>>();
  private disposed = false;

  // presentation
  private pres: Presentation = {
    theme: LIGHT_THEME, pageTint: 'smart', typography: {} as Presentation['typography'], flow: 'scrolled', spread: 'single', zoom: 1, fit: 'width', rotation: 0, direction: 'ltr',
  };
  private firstAlone = true;
  private onExternalLink?: (href: string) => void;

  // DOM
  private target?: HTMLElement;
  private root?: HTMLDivElement;
  private inner?: HTMLDivElement;
  private style?: HTMLStyleElement;
  private rowViews = new Map<number, RowView>();
  private ro?: ResizeObserver;
  private abort?: AbortController;

  // geometry
  private rows: number[][] = [];
  private layout!: Layout;
  private zoom = 1;
  private spreadOn = false;
  private dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

  // rendering
  private cache = new ByteLru<string, ImageBitmap>(BITMAP_BUDGET, (_k, b) => b.close());
  private rects = new Map<string, NormRect[]>();
  private active = new Map<number, ActiveRender>();
  private tinter: GlTinter | null | undefined;
  private settling = false;
  private settleTimer = 0;
  private raf = 0;
  private lastTintMs = 0;
  private paintWaiters = new Map<number, (() => void)[]>();
  private linkService?: PDFLinkService;
  private rotateBusy = false;

  // location
  private last: RelocatedEvent | null = null;
  private pendingReason: RelocatedEvent['reason'] = 'scroll';
  private pendingLocator?: Locator;

  // annotations / selection
  private decos: Record<DecorationLayer, Decoration[]> = { annotations: [], search: [], speech: [] };
  private resolved = new Map<string, Resolved | Promise<Resolved>>();
  private selection: EngineSelection | null = null;
  private selTimer = 0;
  private lastLayoutEmit = 0;

  // ---- events --------------------------------------------------------------------------------

  on<K extends keyof EngineEventMap>(type: K, handler: EngineEventHandler<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(handler as (e: never) => void);
    return () => set!.delete(handler as (e: never) => void);
  }

  private emit<K extends keyof EngineEventMap>(type: K, event: EngineEventMap[K]): void {
    if (this.disposed) return;
    for (const h of [...(this.listeners.get(type) ?? [])]) {
      try {
        (h as EngineEventHandler<K>)(event);
      } catch (e) {
        console.error('[pdf-engine] listener failed', e);
      }
    }
  }

  /** The shell opens external links; the engine never opens windows itself. */
  setExternalLinkHandler(fn: ((href: string) => void) | undefined): void {
    this.onExternalLink = fn;
  }

  /** Spread layout option: keep page 1 alone (as a book cover). Default true. */
  setSpreadFirstPageAlone(on: boolean): void {
    this.firstAlone = on;
    if (this.root) this.rebuildRows(this.captureAnchor());
  }

  /** Diagnostics for tests and the harness. */
  stats() {
    return {
      mountedPages: this.root?.querySelectorAll('.q-page').length ?? 0,
      cachedBitmaps: this.cache.size,
      cachedBytes: this.cache.bytes,
      activeRenders: this.active.size,
      zoom: this.zoom,
      lastTintMs: this.lastTintMs,
      tintPath: this.tinter ? 'webgl2' : 'cpu',
      spread: this.spreadOn,
    };
  }

  // ---- open ----------------------------------------------------------------------------------

  async open(source: BookSource, options?: OpenOptions): Promise<BookHandle> {
    setupPdfjs();
    const { doc, handle } = await PdfDoc.open(source, options);
    if (this.disposed) {
      doc.destroy();
      throw new EngineError('aborted');
    }
    this.doc?.destroy();
    this.doc = doc;
    this.handle = handle;
    this.zoom = 1;
    const bus = new EventBus();
    this.linkService = new PDFLinkService({ eventBus: bus, externalLinkRel: 'noopener noreferrer' });
    this.linkService.setDocument(doc.pdf);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.linkService.setViewer({
      get currentPageNumber() {
        return 1;
      },
      set currentPageNumber(n: number) {
        void self.goTo({ kind: 'fixed', page: n - 1 }, 'navigation');
      },
      pagesRotation: 0,
      isInPresentationMode: false,
      pageLabelToPageNumber: (l: string) => (doc.labels ? doc.labels.indexOf(l) + 1 : 0),
      scrollPageIntoView: ({ pageNumber, destArray }: { pageNumber: number; destArray?: unknown[] }) => {
        const loc = this.destToLocator(pageNumber - 1, destArray);
        this.emit('link', { href: `#page=${pageNumber}`, external: false, target: loc });
        void this.goTo(loc, 'navigation');
      },
      nextPage: () => void this.next(),
      previousPage: () => void this.prev(),
    } as never);
    return handle;
  }

  private destToLocator(page: number, dest?: unknown[]): Locator {
    const info = this.doc?.infos[page] ?? this.doc?.est;
    const kind = (dest?.[1] as { name?: string } | undefined)?.name;
    const top = kind === 'XYZ' ? dest?.[3] : kind === 'FitH' || kind === 'FitBH' ? dest?.[2] : null;
    let y = 0;
    if (typeof top === 'number' && info) y = clamp((info.view[3] - top) / (info.view[3] - info.view[1]), 0, 1);
    return { kind: 'fixed', page, y };
  }

  // ---- render --------------------------------------------------------------------------------

  async render(target: HTMLElement, locator?: Locator): Promise<void> {
    const doc = this.doc;
    if (!doc) throw new EngineError('unknown', 'open() must be called before render()');
    this.teardownDom();
    this.target = target;
    this.abort = new AbortController();
    const signal = this.abort.signal;

    this.style = document.createElement('style');
    this.style.textContent = CSS;
    const root = (this.root = document.createElement('div'));
    root.className = 'q-pdf';
    root.tabIndex = -1;
    root.setAttribute('role', 'document');
    root.setAttribute('aria-label', this.handle?.metadata.title ?? 'PDF document');
    const inner = (this.inner = document.createElement('div'));
    inner.className = 'q-pdf-inner';
    root.append(inner);
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.append(this.style, root);
    this.applyThemeVars();

    root.addEventListener('scroll', () => this.scheduleUpdate(), { passive: true, signal });
    root.addEventListener('wheel', (e) => this.onWheel(e), { passive: false, signal });
    root.addEventListener('click', (e) => this.onClick(e), { capture: true, signal });
    document.addEventListener('selectionchange', () => this.onSelectionChange(), { signal });
    window.addEventListener('resize', () => this.onResize(), { signal });
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(root);

    const start = locator && isFixed(locator) ? locator : this.pendingLocator && isFixed(this.pendingLocator) ? this.pendingLocator : { kind: 'fixed' as const, page: 0, y: 0 };
    this.pendingLocator = undefined;
    const page = clamp(start.page, 0, doc.pageCount - 1);
    await doc.info(page).catch(() => undefined);
    if (this.disposed || this.root !== root) return;
    this.spreadOn = this.wantSpread();
    this.rows = buildRows(doc.pageCount, this.spreadOn, this.firstAlone);
    this.relayout({ page, y: start.y ?? 0 });
    this.root.style.visibility = 'visible';
    await this.awaitPage(page);
    this.last = null;
    this.emitRelocated('initial');
  }

  private teardownDom(): void {
    this.abort?.abort();
    this.ro?.disconnect();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.settleTimer);
    for (const a of this.active.values()) a.cancel();
    this.active.clear();
    for (const r of [...this.rowViews.keys()]) this.unmountRow(r);
    this.root?.remove();
    this.style?.remove();
    this.root = this.inner = this.style = undefined;
    this.paintWaiters.forEach((ws) => ws.forEach((w) => w()));
    this.paintWaiters.clear();
  }

  private wantSpread(): boolean {
    return this.pres.spread === 'double' || (this.pres.spread === 'auto' && this.autoSpread());
  }

  private autoSpread(): boolean {
    const r = this.root;
    return !!r && (this.doc?.pageCount ?? 0) > 1 && r.clientWidth / Math.max(1, r.clientHeight) >= 1.5;
  }

  private onResize(): void {
    if (!this.root || this.disposed) return;
    const dpr = devicePixelRatio || 1;
    if (dpr !== this.dpr) this.dpr = dpr;
    if (this.wantSpread() !== this.spreadOn) this.rebuildRows(this.captureAnchor());
    else this.relayout(this.captureAnchor(), 'resize');
  }

  // ---- layout --------------------------------------------------------------------------------

  private rot(): number {
    return this.pres.rotation;
  }

  private dispSize(i: number): Size {
    const info = this.doc!.infos[i] ?? this.doc!.est;
    const swap = this.rot() % 180 !== 0;
    return swap ? { w: info.h, h: info.w } : { w: info.w, h: info.h };
  }

  private captureAnchor(): { page: number; y: number } {
    if (!this.root || !this.layout) return { page: 0, y: 0 };
    const l = locationAt(this.layout, this.root.scrollTop);
    return { page: l.page, y: l.y };
  }

  private rebuildRows(anchor: { page: number; y: number }): void {
    if (!this.root || !this.doc) return;
    for (const r of [...this.rowViews.keys()]) this.unmountRow(r);
    this.spreadOn = this.wantSpread();
    this.rows = buildRows(this.doc.pageCount, this.spreadOn, this.firstAlone);
    this.relayout(anchor);
  }

  /** Effective zoom for the current fit mode, using the row at `rowIdx` as reference. */
  private effectiveZoom(rowIdx: number): number {
    const root = this.root!;
    if (this.pres.fit === 'custom') return clampZoom(this.pres.zoom);
    const pages = this.rows[rowIdx] ?? [0];
    let w = (pages.length - 1) * PAGE_GAP;
    let h = 0;
    for (const p of pages) {
      const s = this.dispSize(p);
      w += s.w;
      h = Math.max(h, s.h);
    }
    return clampZoom(fitZoom(this.pres.fit, { w: root.clientWidth, h: root.clientHeight }, { w, h }, PAD, this.pres.zoom));
  }

  /**
   * Recompute the whole layout and put the viewport back on `anchor` (a page position, or a point
   * under the cursor when zooming). Mounted rows are repositioned and resized in place.
   */
  private relayout(anchor: { page: number; y: number }, reason: RelocatedEvent['reason'] = 'navigation', point?: { cx: number; cy: number }): void {
    const root = this.root, inner = this.inner, doc = this.doc;
    if (!root || !inner || !doc) return;
    const old = this.layout;
    let pointAnchor: { row: number; frac: number; fx: number } | undefined;
    if (point && old) {
      const docY = root.scrollTop + point.cy;
      const row = rowAt(old.tops, docY);
      pointAnchor = { row, frac: (docY - old.tops[row]) / (old.heights[row] || 1), fx: (root.scrollLeft + point.cx) / Math.max(1, inner.offsetWidth) };
    }
    const centerFrac = inner.offsetWidth ? (root.scrollLeft + root.clientWidth / 2) / inner.offsetWidth : 0.5;
    const refRow = old ? (old.rowOfPage[anchor.page] ?? 0) : 0;
    const prevZoom = this.zoom;
    this.zoom = this.effectiveZoom(clamp(refRow, 0, Math.max(0, this.rows.length - 1)));
    const paginated = this.pres.flow === 'paginated';
    root.classList.toggle('q-snap', paginated);
    this.layout = computeLayout(this.rows, (i) => this.dispSize(i), this.zoom, { viewportH: root.clientHeight, paginated });
    const L = this.layout;
    inner.style.height = `${L.tops[L.tops.length - 1]}px`;
    inner.style.width = `${Math.max(L.width + 2 * PAD, root.clientWidth)}px`;
    for (const [r, rv] of this.rowViews) this.positionRow(r, rv);
    // restore scroll without letting the intermediate scroll event emit a stale location
    if (pointAnchor && point) {
      root.scrollTop = L.tops[pointAnchor.row] + pointAnchor.frac * L.heights[pointAnchor.row] - point.cy;
      root.scrollLeft = pointAnchor.fx * inner.offsetWidth - point.cx;
    } else {
      root.scrollTop = scrollTopFor(L, anchor.page, anchor.y);
      if (!pointAnchor) root.scrollLeft = Math.max(0, centerFrac * inner.offsetWidth - root.clientWidth / 2);
    }
    if (this.zoom !== prevZoom) {
      this.beginSettle();
      this.emit('presentationchange', { zoom: this.zoom, fit: this.pres.fit });
    }
    this.update(reason);
    this.emitLayout();
  }

  private positionRow(r: number, rv: RowView): void {
    const L = this.layout;
    rv.el.style.top = `${L.tops[r]}px`;
    rv.el.style.height = `${L.heights[r]}px`;
    rv.el.style.paddingTop = `${L.contentTops[r]}px`;
    rv.el.style.flexDirection = this.pres.direction === 'rtl' ? 'row-reverse' : 'row';
    rv.el.style.alignItems = 'flex-start';
    const scale = this.zoom * PDF_TO_CSS;
    for (const pv of rv.pages) {
      const s = this.dispSize(pv.i);
      pv.el.style.width = `${s.w * this.zoom}px`;
      pv.el.style.height = `${s.h * this.zoom}px`;
      pv.el.style.setProperty('--scale-factor', String(scale));
      pv.el.style.setProperty('--total-scale-factor', String(scale));
    }
  }

  // ---- virtualisation ------------------------------------------------------------------------

  private scheduleUpdate(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.update('scroll');
    });
  }

  private visibleRowRange(): [number, number] {
    const root = this.root!;
    const L = this.layout;
    const y0 = root.scrollTop;
    const y1 = y0 + root.clientHeight;
    return [rowAt(L.tops, y0), rowAt(L.tops, Math.max(y0, y1 - 1))];
  }

  /** Mount rows near the viewport, unmount the rest, queue renders, report the position. */
  private update(reason: RelocatedEvent['reason']): void {
    if (!this.root || !this.layout || !this.doc) return;
    const [v0, v1] = this.visibleRowRange();
    const lo = Math.max(0, v0 - 1);
    const hi = Math.min(this.rows.length - 1, v1 + 1);
    for (const r of [...this.rowViews.keys()]) if (r < lo - 1 || r > hi + 1) this.unmountRow(r);
    for (let r = lo; r <= hi; r++) if (!this.rowViews.has(r)) this.mountRow(r);
    this.pump();
    this.emitRelocated(reason);
  }

  private mountRow(r: number): void {
    const el = document.createElement('div');
    el.className = 'q-row';
    const pages = this.rows[r].map((i) => this.createPage(i));
    el.append(...pages.map((p) => p.el));
    const rv: RowView = { el, pages };
    this.rowViews.set(r, rv);
    this.positionRow(r, rv);
    this.inner!.append(el);
    for (const pv of pages) void this.preparePage(pv);
  }

  private unmountRow(r: number): void {
    const rv = this.rowViews.get(r);
    if (!rv) return;
    this.rowViews.delete(r);
    for (const pv of rv.pages) {
      pv.dead = true;
      this.active.get(pv.i)?.cancel();
      this.active.delete(pv.i);
      pv.textB?.cancel();
      pv.annoB?.cancel();
      void pv.proxy?.cleanup?.();
    }
    rv.el.remove();
  }

  private createPage(i: number): PageView {
    const el = document.createElement('div');
    el.className = 'q-page';
    el.dataset.page = String(i);
    el.setAttribute('role', 'group');
    const label = this.doc?.labels?.[i];
    el.setAttribute('aria-label', `Page ${label && label !== String(i + 1) ? label : i + 1} of ${this.doc?.pageCount}`);
    this.setPlaceholder(el);
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'presentation');
    const deco = document.createElement('div');
    deco.className = 'q-deco';
    const ocr = document.createElement('div');
    ocr.className = 'q-ocr';
    el.append(canvas, deco, ocr);
    return { i, el, canvas, ctx: canvas.getContext('2d')!, deco, ocr };
  }

  private setPlaceholder(el: HTMLElement): void {
    // Painted from the theme so dark themes never flash white while a page renders.
    el.style.setProperty('--q-page-bg', this.pres.pageTint === 'smart' ? this.pres.theme.bg : this.pres.theme.surface);
  }

  /** Fetch the page proxy, then queue layers, decorations and canvas rendering. */
  private async preparePage(pv: PageView): Promise<void> {
    const doc = this.doc!;
    try {
      await doc.info(pv.i);
      if (pv.dead) return;
      // Size correction: if this page differs from the estimate it was laid out with, re-layout while keeping the anchor.
      const s = this.dispSize(pv.i);
      if (Math.abs(parseFloat(pv.el.style.width) - s.w * this.zoom) > 0.5 || Math.abs(parseFloat(pv.el.style.height) - s.h * this.zoom) > 0.5) this.relayoutSoon();
      pv.proxy = await doc.proxy(pv.i);
      if (pv.dead) return;
      this.setVp1(pv);
      this.drawDecorations(pv);
      this.drawOcr(pv);
      this.pump();
      void this.ensureLayers(pv);
    } catch (e) {
      if (!pv.dead) this.emit('warning', mapError(e));
    }
  }

  private relayoutTimer = 0;
  private relayoutSoon(): void {
    if (this.relayoutTimer) return;
    this.relayoutTimer = requestAnimationFrame(() => {
      this.relayoutTimer = 0;
      if (this.root) this.relayout(this.pendingTarget ?? this.captureAnchor(), 'resize');
    });
  }
  private pendingTarget?: { page: number; y: number };

  private setVp1(pv: PageView): void {
    if (!pv.proxy) return;
    const rotation = (pv.proxy.rotate + this.rot()) % 360;
    if (pv.vp1 && pv.vp1Rot === rotation) return;
    pv.vp1 = pv.proxy.getViewport({ scale: 1, rotation });
    pv.vp1Rot = rotation;
  }

  private viewportFor(pv: PageView): PageViewport {
    return pv.proxy!.getViewport({ scale: this.zoom * PDF_TO_CSS, rotation: (pv.proxy!.rotate + this.rot()) % 360 });
  }

  /** Text layer + annotation layer (links, form widgets), kept in sync with the zoom/rotation. */
  private async ensureLayers(pv: PageView): Promise<void> {
    if (!pv.proxy || pv.dead || pv.layerBusy) return;
    const key = `${this.zoom.toFixed(4)}|${this.rot()}`;
    if (pv.layerKey === key) return;
    pv.layerBusy = true;
    try {
      const viewport = this.viewportFor(pv);
      if (!pv.textB) pv.textB = new TextLayerBuilder({ pdfPage: pv.proxy, onAppend: (div: HTMLDivElement) => pv.el.append(div) });
      if (!pv.annoB && this.linkService)
        pv.annoB = new AnnotationLayerBuilder({
          pdfPage: pv.proxy, linkService: this.linkService, annotationStorage: this.doc!.pdf.annotationStorage, renderForms: true, onAppend: (div: HTMLDivElement) => pv.el.append(div),
        } as never);
      await Promise.all([pv.textB.render({ viewport } as never), pv.annoB?.render({ viewport, intent: 'display' } as never)]);
      pv.layerKey = key;
    } catch (e) {
      if (!pv.dead) this.emit('warning', mapError(e));
    } finally {
      pv.layerBusy = false;
    }
    if (!pv.dead && pv.layerKey !== `${this.zoom.toFixed(4)}|${this.rot()}`) void this.ensureLayers(pv);
  }

  // ---- bitmap rendering ----------------------------------------------------------------------

  private renderScale(i: number): number {
    const s = this.dispSize(i);
    const want = this.zoom * PDF_TO_CSS * this.dpr;
    const area = (s.w / PDF_TO_CSS) * (s.h / PDF_TO_CSS) * want * want;
    return area > MAX_CANVAS_PIXELS ? want * Math.sqrt(MAX_CANVAS_PIXELS / area) : want;
  }

  private keyFor(i: number): string {
    return `${i}|${Math.round(this.renderScale(i) * 1000)}|${this.rot()}`;
  }

  private pageViews(): PageView[] {
    return [...this.rowViews.values()].flatMap((r) => r.pages);
  }

  /** Visible pages first (centre-out), then the neighbouring rows. */
  private wanted(): number[] {
    const root = this.root!;
    const L = this.layout;
    const [v0, v1] = this.visibleRowRange();
    const mid = root.scrollTop + root.clientHeight / 2;
    const dist = (r: number) => Math.abs(L.tops[r] + L.heights[r] / 2 - mid);
    const vis: number[] = [];
    for (let r = v0; r <= v1; r++) vis.push(r);
    vis.sort((a, b) => dist(a) - dist(b));
    const near: number[] = [];
    for (const r of [v0 - 1, v1 + 1, v0 - 2, v1 + 2]) if (r >= 0 && r < this.rows.length) near.push(r);
    return [...vis, ...near].flatMap((r) => this.rows[r]);
  }

  private pump(): void {
    if (!this.root || !this.layout || this.disposed) return;
    const want = this.wanted();
    const wantSet = new Set(want);
    for (const [i, a] of this.active) {
      if (!wantSet.has(i) || a.key !== this.keyFor(i)) {
        a.cancel();
        this.active.delete(i);
      }
    }
    const byIndex = new Map(this.pageViews().map((p) => [p.i, p]));
    for (const i of want) {
      const pv = byIndex.get(i);
      if (!pv || !pv.proxy) continue;
      const key = this.keyFor(i);
      if (this.cache.has(key)) {
        if (pv.shownKey !== key) this.present(pv);
        continue;
      }
      if (this.active.has(i) || this.active.size >= MAX_ACTIVE_RENDERS) continue;
      if (this.settling && pv.shownKey) continue; // keep the stretched old bitmap until the zoom settles
      void this.renderPage(pv, key);
    }
  }

  private beginSettle(): void {
    this.settling = true;
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.settling = false;
      const keep = new Set(this.pageViews().map((p) => this.keyFor(p.i)));
      this.cache.deleteWhere((k) => !keep.has(k) && !this.isRecentKey(k));
      for (const pv of this.pageViews()) void this.ensureLayers(pv);
      this.pump();
    }, ZOOM_SETTLE_MS);
  }

  private isRecentKey(k: string): boolean {
    const scale = Math.round(this.zoom * PDF_TO_CSS * this.dpr * 1000);
    return k.split('|')[1] === String(scale) && k.split('|')[2] === String(this.rot());
  }

  private async renderPage(pv: PageView, key: string): Promise<void> {
    const pg = pv.proxy;
    if (!pg) return;
    const rotation = (pg.rotate + this.rot()) % 360;
    const vp = pg.getViewport({ scale: this.renderScale(pv.i), rotation });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(vp.width));
    canvas.height = Math.max(1, Math.ceil(vp.height));
    let task: ReturnType<PDFPageProxy['render']> | undefined;
    let cancelled = false;
    this.active.set(pv.i, { key, cancel: () => { cancelled = true; task?.cancel(); } });
    try {
      task = pg.render({ canvas, viewport: vp, annotationMode: 1 /* ENABLE_FORMS: widgets live in the DOM layer */ });
      await task.promise;
      if (cancelled || pv.dead) return;
      // Image regions (for Smart tint) come from the operator list pdf.js already parsed for this render.
      try {
        const ops = await pg.getOperatorList({ intent: 'display', annotationMode: 1 });
        this.rects.set(`${pv.i}|${rotation}`, imageRects(ops as never, pg.view, pg.rotate).map((r) => rotateNormRect(r, this.rot())));
      } catch {
        this.rects.set(`${pv.i}|${rotation}`, []);
      }
      const bm = await createImageBitmap(canvas);
      if (cancelled || pv.dead) {
        bm.close();
        return;
      }
      this.cache.set(key, bm, bm.width * bm.height * 4);
      this.active.delete(pv.i);
      if (this.keyFor(pv.i) === key) this.present(pv);
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name !== 'RenderingCancelledException' && !cancelled) this.emit('warning', mapError(e));
    } finally {
      if (this.active.get(pv.i)?.key === key) this.active.delete(pv.i);
      canvas.width = canvas.height = 0;
      this.pump();
    }
  }

  /** Put the cached untinted bitmap on the page canvas, tinted per the presentation. */
  private present(pv: PageView): void {
    const key = this.keyFor(pv.i);
    const bm = this.cache.get(key);
    if (!bm || pv.dead) return;
    const { canvas, ctx } = pv;
    if (canvas.width !== bm.width || canvas.height !== bm.height) {
      canvas.width = bm.width;
      canvas.height = bm.height;
    }
    const mode = this.pres.pageTint;
    const { bg, fg } = this.tintColors();
    const identity = mode === 'smart' && bg.every((v) => v >= 252) && fg.every((v) => v <= 3);
    if (mode === 'smart' && !identity) {
      const t0 = performance.now();
      const rects = this.rects.get(`${pv.i}|${(pv.proxy!.rotate + this.rot()) % 360}`) ?? [];
      this.tinter ??= GlTinter.create();
      if (this.tinter) {
        ctx.drawImage(this.tinter.tint(bm, bg, fg, rects), 0, 0);
      } else {
        ctx.drawImage(bm, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        smartTintImageData(img, bg, fg, rects);
        ctx.putImageData(img, 0, 0);
      }
      this.lastTintMs = performance.now() - t0;
    } else ctx.drawImage(bm, 0, 0);
    canvas.style.filter = mode === 'invert' ? INVERT_FILTER : '';
    pv.shownKey = key;
    pv.el.dataset.rendered = 'true';
    pv.el.dataset.tint = mode;
    this.paintWaiters.get(pv.i)?.forEach((w) => w());
    this.paintWaiters.delete(pv.i);
    this.emitLayout();
  }

  private tintColors(): { bg: RGB; fg: RGB } {
    return { bg: parseCssColor(this.pres.theme.bg), fg: parseCssColor(this.pres.theme.text) };
  }

  private awaitPage(page: number, timeoutMs = 8000): Promise<void> {
    const pv = this.pageViews().find((p) => p.i === page);
    if (!pv || pv.shownKey) return Promise.resolve();
    return new Promise((res) => {
      const t = setTimeout(res, timeoutMs);
      const list = this.paintWaiters.get(page) ?? [];
      list.push(() => { clearTimeout(t); res(); });
      this.paintWaiters.set(page, list);
    });
  }

  private retintAll(): void {
    for (const pv of this.pageViews()) {
      this.setPlaceholder(pv.el);
      pv.shownKey = undefined;
    }
    this.pump();
  }

  private applyThemeVars(): void {
    const r = this.root;
    if (!r) return;
    const t = this.pres.theme;
    r.style.setProperty('--q-surface', t.surface);
    r.style.setProperty('--q-selection', t.selection);
    r.style.setProperty('--q-accent', t.accent);
    r.style.setProperty('--q-shadow', t.shadow);
    r.style.setProperty('--q-scheme', t.dark ? 'dark' : 'light');
    for (const pv of this.pageViews()) this.setPlaceholder(pv.el);
  }

  // ---- navigation ----------------------------------------------------------------------------

  async goTo(locator: Locator, reason: RelocatedEvent['reason'] = 'navigation'): Promise<void> {
    if (!isFixed(locator)) throw new EngineError('unsupported-format', 'PDF locators are { kind: "fixed" }.');
    const doc = this.doc;
    if (!doc) throw new EngineError('unknown', 'open() first');
    const page = clamp(Math.round(locator.page), 0, doc.pageCount - 1);
    const y = clamp(locator.y ?? 0, 0, 1);
    if (!this.root) {
      this.pendingLocator = { kind: 'fixed', page, y };
      return;
    }
    // Learn the target page's real size first so the jump lands exactly, then re-anchor as neighbours load.
    await doc.info(page);
    this.pendingTarget = { page, y };
    this.relayout({ page, y }, reason);
    this.last = null;
    this.emitRelocated(reason);
    await this.awaitPage(page);
    // Sizes of pages mounted on the way may have changed the layout; settle on the target again.
    if (this.pendingTarget?.page === page) {
      const cur = this.captureAnchor();
      if (cur.page !== page || Math.abs(cur.y - y) > 0.002) this.relayout({ page, y }, reason);
    }
    this.pendingTarget = undefined;
  }

  async goToFraction(fraction: number): Promise<void> {
    const n = this.doc?.pageCount ?? 1;
    const f = clamp(fraction, 0, 1) * n;
    const page = Math.min(n - 1, Math.floor(f));
    await this.goTo({ kind: 'fixed', page, y: f - page });
  }

  async next(): Promise<boolean> {
    return this.turn(1);
  }
  async prev(): Promise<boolean> {
    return this.turn(-1);
  }

  private async turn(dir: 1 | -1): Promise<boolean> {
    const root = this.root;
    if (!root || !this.layout) return false;
    if (this.pres.flow === 'paginated') {
      const cur = rowAt(this.layout.tops, root.scrollTop + root.clientHeight / 2);
      const r = cur + dir;
      if (r < 0 || r >= this.rows.length) return false;
      root.scrollTop = this.layout.tops[r];
    } else {
      const max = root.scrollHeight - root.clientHeight;
      if (dir > 0 ? root.scrollTop >= max - 1 : root.scrollTop <= 0) return false;
      root.scrollTop += dir * root.clientHeight * 0.92;
    }
    this.update('page-turn');
    await this.awaitPage(this.last?.progress.page?.index ?? 0);
    return true;
  }

  scrollBy(dy: number): void {
    if (this.root && this.pres.flow === 'scrolled') this.root.scrollTop += dy;
  }

  getLocation(): RelocatedEvent | null {
    return this.root && this.layout ? this.buildEvent('scroll') : this.last;
  }

  private buildEvent(reason: RelocatedEvent['reason']): RelocatedEvent {
    const doc = this.doc!;
    const { page, y } = locationAt(this.layout, this.root!.scrollTop);
    const ch = doc.chapterAt(page, y);
    return {
      locator: { kind: 'fixed', page, y },
      progress: {
        fraction: fractionOf(page, y, doc.pageCount),
        chapter: ch ? { index: ch.index, title: ch.title } : undefined,
        page: { index: page, count: doc.pageCount, label: doc.labels?.[page] },
      },
      reason,
    };
  }

  private emitRelocated(reason: RelocatedEvent['reason']): void {
    if (!this.root || !this.layout || !this.doc) return;
    const ev = this.buildEvent(reason);
    const prev = this.last?.locator;
    const loc = ev.locator;
    if (prev && isFixed(prev) && isFixed(loc) && prev.page === loc.page && Math.abs((prev.y ?? 0) - (loc.y ?? 0)) < 1e-4) return;
    this.last = ev;
    this.emit('relocated', ev);
  }

  private emitLayout(): void {
    if (this.lastLayoutEmit) return;
    this.lastLayoutEmit = requestAnimationFrame(() => {
      this.lastLayoutEmit = 0;
      this.emit('layout', undefined);
      for (const pv of this.pageViews()) this.drawDecorations(pv);
    });
  }

  // ---- presentation --------------------------------------------------------------------------

  setPresentation(p: Partial<Presentation>): void {
    const prev = this.pres;
    this.pres = { ...prev, ...p, theme: p.theme ?? prev.theme };
    if (!this.root || !this.doc) return;
    if (p.theme) this.applyThemeVars();
    if (p.theme || (p.pageTint && p.pageTint !== prev.pageTint)) this.retintAll();
    const geometry = (['flow', 'spread', 'zoom', 'fit', 'rotation', 'direction'] as const).some((k) => k in p && p[k] !== prev[k]);
    if (!geometry) return;
    const anchor = this.captureAnchor();
    if (p.rotation !== undefined && p.rotation !== prev.rotation) {
      for (const pv of this.pageViews()) {
        pv.shownKey = undefined;
        pv.layerKey = undefined;
        this.setVp1(pv);
      }
    }
    if (this.wantSpread() !== this.spreadOn || p.direction !== undefined) this.rebuildRows(anchor);
    else this.relayout(anchor, 'presentation');
    if (p.rotation !== undefined || p.flow !== undefined) for (const pv of this.pageViews()) void this.ensureLayers(pv);
  }

  /** Convenience for the shell's zoom commands. */
  zoomBy(factor: number, at?: { x: number; y: number }): void {
    this.zoomTo(this.zoom * factor, at);
  }

  private zoomTo(z: number, at?: { x: number; y: number }): void {
    if (!this.root) return;
    const r = this.root.getBoundingClientRect();
    const cx = at ? at.x - r.left : r.width / 2;
    const cy = at ? at.y - r.top : r.height / 2;
    this.pres = { ...this.pres, fit: 'custom', zoom: clampZoom(z) };
    this.relayout(this.captureAnchor(), 'presentation', { cx, cy });
    this.beginSettle();
  }

  private onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault(); // trackpad pinch arrives as ctrl+wheel
    const k = e.deltaMode === 1 ? 0.05 : 0.0025;
    this.zoomTo(this.zoom * Math.exp(-e.deltaY * k), { x: e.clientX, y: e.clientY });
  }

  private onClick(e: MouseEvent): void {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (a && this.root?.contains(a)) {
      const href = a.getAttribute('href') ?? '';
      if (!href.startsWith('#')) {
        e.preventDefault();
        e.stopPropagation();
        this.emit('link', { href: a.href, external: true });
        this.onExternalLink?.(a.href);
      }
      return;
    }
    if ((e.target as Element | null)?.closest?.('input,textarea,select,button')) return;
    if (window.getSelection()?.toString()) return;
    const t = this.target?.getBoundingClientRect();
    if (!t) return;
    const x = e.clientX - t.left;
    this.emit('pointer', { x, y: e.clientY - t.top, zone: x < t.width / 3 ? 'left' : x > (t.width * 2) / 3 ? 'right' : 'center', button: e.button });
  }

  // ---- decorations, anchors ------------------------------------------------------------------

  setDecorations(layer: DecorationLayer, items: Decoration[]): void {
    this.decos[layer] = items;
    for (const k of [...this.resolved.keys()]) if (k.startsWith(`${layer}|`)) this.resolved.delete(k);
    for (const pv of this.pageViews()) this.drawDecorations(pv);
  }

  /** Quads for a decoration: stored quads right away, otherwise re-anchored by quote (async, then redrawn). */
  private quadsOf(layer: DecorationLayer, d: Decoration): Resolved | undefined {
    if (d.anchor.pdfQuads?.length && d.anchor.locator.kind === 'fixed') return { page: d.anchor.locator.page, quads: d.anchor.pdfQuads };
    const key = `${layer}|${d.id}`;
    const hit = this.resolved.get(key);
    if (hit && !(hit instanceof Promise)) return hit;
    if (!hit) {
      const p = this.resolveAnchor(d.anchor).then((r) => {
        const res = r ? { page: r.page, quads: r.quads } : null;
        this.resolved.set(key, res);
        for (const pv of this.pageViews()) this.drawDecorations(pv);
        return res;
      });
      this.resolved.set(key, p);
    }
    return undefined;
  }

  private drawDecorations(pv: PageView): void {
    if (pv.dead || !pv.vp1) return;
    const theme = this.pres.theme;
    const frag = document.createDocumentFragment();
    for (const layer of ['annotations', 'search', 'speech'] as DecorationLayer[]) {
      for (const d of this.decos[layer]) {
        const res = this.quadsOf(layer, d);
        if (!res || res.page !== pv.i) continue;
        const style = d.style;
        const color = 'color' in style ? theme.highlight[style.color] : theme.accent;
        for (const q of res.quads) {
          const box = this.boxFor(pv, q);
          const el = document.createElement('div');
          el.className = `q-d q-d-${style.type}`;
          el.dataset.deco = d.id;
          el.dataset.layer = layer;
          el.style.cssText = `left:${box.left}%;top:${box.top}%;width:${box.width}%;height:${box.height}%;--c:${color};`;
          switch (style.type) {
            case 'highlight': case 'note': el.style.background = `color-mix(in srgb, ${color} 42%, transparent)`; break;
            case 'search-hit': el.style.background = `color-mix(in srgb, ${theme.highlight[0]} ${style.current ? 85 : 55}%, transparent)`; if (style.current) el.classList.add('q-d-current'); break;
            case 'speech-word': el.style.background = `color-mix(in srgb, ${theme.accent} 45%, transparent)`; break;
            case 'speech-sentence': el.style.background = `color-mix(in srgb, ${theme.accent} 16%, transparent)`; break;
            case 'bookmark': el.style.top = `${box.top}%`; break;
          }
          frag.append(el);
          if (style.type === 'bookmark') break;
        }
      }
    }
    pv.deco.replaceChildren(frag);
  }

  /** Page-space quad -> percentage box of the displayed page (survives zoom without redrawing). */
  private boxFor(pv: PageView, q: number[]): { left: number; top: number; width: number; height: number } {
    const info = this.doc!.infos[pv.i] ?? this.doc!.est;
    const v = info.view;
    const rect = [q[0] + v[0], v[3] - q[1] - q[3], q[0] + q[2] + v[0], v[3] - q[1]];
    const [a, b] = pv.vp1!.convertToViewportPoint(rect[0], rect[1]);
    const [c, d] = pv.vp1!.convertToViewportPoint(rect[2], rect[3]);
    return pctBox([Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)], pv.vp1!.width, pv.vp1!.height);
  }

  /** Where a quad currently is, in CSS px relative to the render target. */
  private screenRect(pv: PageView, q: number[], t: DOMRect): Rect {
    const box = this.boxFor(pv, q);
    const b = pv.el.getBoundingClientRect();
    return { x: b.left - t.left + (box.left / 100) * b.width, y: b.top - t.top + (box.top / 100) * b.height, width: (box.width / 100) * b.width, height: (box.height / 100) * b.height };
  }

  private async resolveAnchor(anchor: Anchor): Promise<{ page: number; quads: number[][]; exact: boolean; updated?: Anchor } | null> {
    const doc = this.doc;
    if (!doc || anchor.locator.kind !== 'fixed') return null;
    const home = clamp(anchor.locator.page, 0, doc.pageCount - 1);
    const q = anchor.quote;
    if (anchor.pdfQuads?.length && q.exact) {
      const pt = await doc.pageText(home);
      const r = rangeForQuads(pt, anchor.pdfQuads);
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      if (r && (norm(pt.text.slice(r.start, r.end)).includes(norm(q.exact)) || norm(q.exact).includes(norm(pt.text.slice(r.start, r.end))))) return { page: home, quads: anchor.pdfQuads, exact: true };
    } else if (!q.exact) return anchor.pdfQuads?.length ? { page: home, quads: anchor.pdfQuads, exact: true } : null;
    for (const page of [home, home + 1, home - 1, home + 2, home - 2]) {
      if (page < 0 || page >= doc.pageCount) continue;
      const pt = await doc.pageText(page);
      const m = fuzzyFind(pt.text, q);
      if (!m) continue;
      const quads = quadsFor(pt, m.start, m.end);
      if (!quads.length) continue;
      const y = quads[0][1] / pt.h;
      return { page, quads, exact: false, updated: { locator: { kind: 'fixed', page, y }, quote: makeQuote(pt.text, m.start, m.end), pdfQuads: quads } };
    }
    return null;
  }

  async anchorToRanges(anchor: Anchor): Promise<ResolvedAnchor | null> {
    const r = await this.resolveAnchor(anchor);
    if (!r) return null;
    const t = this.target?.getBoundingClientRect();
    const pv = this.pageViews().find((p) => p.i === r.page);
    const region: AnchorRegion = { page: r.page, rects: pv && t && pv.vp1 ? r.quads.map((q) => this.screenRect(pv, q, t)) : [] };
    return { regions: [region], exact: r.exact, updated: r.updated };
  }

  // ---- selection -----------------------------------------------------------------------------

  private onSelectionChange(): void {
    clearTimeout(this.selTimer);
    this.selTimer = window.setTimeout(() => void this.refreshSelection(), 120);
  }

  private async refreshSelection(): Promise<void> {
    if (this.disposed || !this.root) return;
    const sel = window.getSelection();
    const inside = !!sel && sel.rangeCount > 0 && !sel.isCollapsed && this.root.contains(sel.anchorNode) && this.root.contains(sel.focusNode);
    const next = inside ? await this.buildSelection(sel!.getRangeAt(0), sel!.toString()) : null;
    if (!next && !this.selection) return;
    this.selection = next;
    this.emit('selection', next);
  }

  private pageOf(node: Node | null): PageView | undefined {
    const el = node instanceof Element ? node : node?.parentElement;
    const pe = el?.closest?.('.q-page') as HTMLElement | null;
    return pe ? this.pageViews().find((p) => p.el === pe) : undefined;
  }

  private async buildSelection(range: Range, text: string): Promise<EngineSelection | null> {
    const pv = this.pageOf(range.startContainer);
    const t = this.target?.getBoundingClientRect();
    if (!pv || !pv.vp1 || !t) return null;
    const pb = pv.el.getBoundingClientRect();
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    const onPage = rects.filter((r) => r.left + r.width / 2 >= pb.left && r.left + r.width / 2 <= pb.right && r.top + r.height / 2 >= pb.top && r.top + r.height / 2 <= pb.bottom);
    if (!onPage.length) return null;
    const quads = this.mergeLines(onPage.map((r) => this.clientToQuad(pv, r)));
    const pt = await this.doc!.pageText(pv.i).catch(() => null);
    let quote = { exact: text.replace(/\s+/g, ' ').trim(), prefix: '', suffix: '' };
    if (pt) {
      const r = rangeForQuads(pt, quads);
      if (r) {
        // Prefer the occurrence of the selected text nearest the quads' position for prefix/suffix.
        let best = -1;
        for (let i = pt.text.indexOf(quote.exact); i >= 0; i = pt.text.indexOf(quote.exact, i + 1)) if (best < 0 || Math.abs(i - r.start) < Math.abs(best - r.start)) best = i;
        quote = best >= 0 ? makeQuote(pt.text, best, best + quote.exact.length) : { ...makeQuote(pt.text, r.start, r.end), exact: quote.exact };
      }
    }
    const anchor: Anchor = { locator: { kind: 'fixed', page: pv.i, y: quads[0][1] / (pt?.h ?? this.doc!.pageSpace(pv.i).h) }, quote, pdfQuads: quads };
    return { anchor, text, rects: onPage.map((r) => ({ x: r.left - t.left, y: r.top - t.top, width: r.width, height: r.height })) };
  }

  private clientToQuad(pv: PageView, r: DOMRect): number[] {
    const b = pv.el.getBoundingClientRect();
    const s = this.zoom * PDF_TO_CSS;
    const vp = pv.vp1!;
    const p1 = vp.convertToPdfPoint((r.left - b.left) / s, (r.top - b.top) / s);
    const p2 = vp.convertToPdfPoint((r.right - b.left) / s, (r.bottom - b.top) / s);
    const v = (this.doc!.infos[pv.i] ?? this.doc!.est).view;
    const y1 = Math.max(p1[1], p2[1]);
    return [Math.min(p1[0], p2[0]) - v[0], v[3] - y1, Math.abs(p2[0] - p1[0]), Math.abs(p2[1] - p1[1])];
  }

  private mergeLines(quads: number[][]): number[][] {
    const out: number[][] = [];
    for (const q of quads.sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
      const l = out[out.length - 1];
      if (l && Math.abs(l[1] + l[3] / 2 - (q[1] + q[3] / 2)) < Math.max(l[3], q[3]) * 0.5 && q[0] <= l[0] + l[2] + Math.max(l[3], q[3])) {
        const top = Math.min(l[1], q[1]);
        const bottom = Math.max(l[1] + l[3], q[1] + q[3]);
        const right = Math.max(l[0] + l[2], q[0] + q[2]);
        const left = Math.min(l[0], q[0]);
        l[0] = left; l[1] = top; l[2] = right - left; l[3] = bottom - top;
      } else out.push([...q]);
    }
    return out;
  }

  async selectionToAnchor(selection?: Selection | null): Promise<Anchor | null> {
    const sel = selection ?? window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !this.root?.contains(sel.anchorNode)) return null;
    return (await this.buildSelection(sel.getRangeAt(0), sel.toString()))?.anchor ?? null;
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

  // ---- delegated document features -----------------------------------------------------------

  search(query: string, options?: SearchOptions): AsyncIterable<SearchHit> {
    if (!this.doc) throw new EngineError('unknown', 'open() first');
    return this.doc.search(query, options);
  }
  getText(range: TextRange): Promise<string> {
    if (!this.doc) throw new EngineError('unknown', 'open() first');
    return this.doc.getText(range);
  }
  textStream(from?: Locator, options?: TextStreamOptions): AsyncIterable<TextChunk> {
    if (!this.doc) throw new EngineError('unknown', 'open() first');
    return this.doc.textStream(from, options);
  }
  thumbnail = (page: number, maxWidth: number): Promise<ImageBitmap | null> => this.doc?.thumbnail(page, maxWidth) ?? Promise.resolve(null);
  /** Alias of `thumbnail` (the name used in the task brief). */
  renderThumbnail = this.thumbnail;

  async ocrPageSize(page: number): Promise<{ width: number; height: number; rotate: 0 | 90 | 180 | 270 } | null> {
    if (!this.doc || page < 0 || page >= this.doc.pageCount) return null;
    const i = await this.doc.info(page);
    return { width: i.view[2] - i.view[0], height: i.view[3] - i.view[1], rotate: ((((i.rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270) };
  }

  setOcrWords(page: number, words: OcrWord[]): void {
    this.doc?.setOcrWords(page, words);
    if (this.handle && words.length) this.handle.hasText = true;
    for (const pv of this.pageViews()) if (pv.i === page) this.drawOcr(pv);
  }

  /** Synthetic transparent text layer for pages with OCR words: selection and copy work on scans. */
  private drawOcr(pv: PageView): void {
    const words = this.doc?.ocr.get(pv.i);
    pv.ocr.replaceChildren();
    if (!words?.length || !pv.vp1) return;
    const frag = document.createDocumentFragment();
    for (const w of words) {
      const box = this.boxFor(pv, [w.x, w.y, w.width, w.height]);
      const s = document.createElement('span');
      s.textContent = `${w.text} `;
      s.style.cssText = `left:${box.left}%;top:${box.top}%;width:${box.width}%;height:${box.height}%;font-size:calc(var(--total-scale-factor) * ${w.height * 0.85}px)`;
      frag.append(s);
    }
    pv.ocr.append(frag);
  }

  // ---- teardown ------------------------------------------------------------------------------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardownDom();
    clearTimeout(this.selTimer);
    cancelAnimationFrame(this.relayoutTimer);
    cancelAnimationFrame(this.lastLayoutEmit);
    this.cache.clear();
    this.rects.clear();
    this.tinter?.dispose();
    this.tinter = undefined;
    this.doc?.destroy();
    this.doc = undefined;
    this.listeners.clear();
    this.decos = { annotations: [], search: [], speech: [] };
    this.resolved.clear();
  }
}

/** Factory matching `EngineFactory`. */
export async function createPdfEngine(): Promise<Engine> {
  return new PdfEngine();
}
