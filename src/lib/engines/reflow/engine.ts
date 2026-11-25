/**
 * Reflow Engine: EPUB 2/3, MOBI, AZW3 (KF8), FB2/FBZ on foliate-js.
 *
 * Layering
 *   loader.ts      file -> foliate "book" (Range access, DRM/corrupt classification)
 *   stylesheet.ts  Theme + TypographyProfile -> user stylesheet and paginator attributes (pure)
 *   textmap.ts     normalised text <-> DOM positions (chunks, quotes, fuzzy re-anchoring)
 *   engine.ts      this file: Engine interface on top of <foliate-view>
 *
 * Positions are EPUB CFIs of the first visible character (`Locator.cfi`); `fraction` is a
 * section-size estimate used as fallback and for progress. Headless use (open + search/getText/
 * textStream, no render) is supported: those work on parsed documents, never on the live iframes.
 */
import * as CFI from 'foliate-js/epubcfi.js';
import { SectionProgress } from 'foliate-js/progress.js';
import { searchMatcher } from 'foliate-js/search.js';
import { textWalker } from 'foliate-js/text-walker.js';
import {
  EngineError,
  type Anchor,
  type AnchorRegion,
  type BookHandle,
  type BookMetadata,
  type BookSource,
  type ChapterInfo,
  type Decoration,
  type DecorationLayer,
  type Engine,
  type EngineEventHandler,
  type EngineEventMap,
  type EngineSelection,
  type Locator,
  type OpenOptions,
  type Presentation,
  type Progress,
  type Rect,
  type RelocatedEvent,
  type ResolvedAnchor,
  type SearchHit,
  type SearchOptions,
  type TextChunk,
  type TextRange,
  type TextStreamOptions,
  type TocEntry,
} from '../types';
import { drawFor } from './decorations';
import { FONT_FILES, fontFaceCss, stackFor } from './fontfaces';
import { noteElement, noteRefKind, referencedType, sanitizeNote } from './footnotes';
import { loadBook, type LoadedBook } from './loader';
import { buildStyles, layoutAttrs } from './stylesheet';
import { buildTextMap, chunkSentences, findQuote, normaliseWs, rangeOfText, textOffsetOf, type TextMap } from './textmap';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Safe default so `render()` works before the shell pushes its first Presentation. */
const DEFAULT_PRESENTATION: Presentation = {
  theme: {
    id: 'light', name: 'Light', dark: false, bg: '#faf7f0', surface: '#f3efe6', text: '#1d1b17', muted: '#6b665c',
    accent: '#a8651c', link: '#2a5a9a', selection: '#cfe0f5', highlight: ['#f6e08a', '#bfe3b4', '#b6d4f2', '#f2bdd6'], shadow: '#000',
  },
  pageTint: 'smart',
  typography: {
    fontFamily: 'literata', fontSize: 19, fontWeight: 400, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0,
    paragraphSpacing: 0.6, textIndent: 0, textAlign: 'start', hyphenation: true, marginX: 6, marginY: 5, maxLineWidth: 66,
    columns: 'auto', overridePublisher: 'off',
  },
  flow: 'paginated', spread: 'auto', zoom: 1, fit: 'page', rotation: 0, direction: 'ltr',
};

/** Bytes of section markup per word: markup inflates text ~1.3x, an English word averages ~6.1 bytes. */
const BYTES_PER_WORD = 8;
const KEY_EVENTS = ['keydown', 'keyup'] as const;
const EXTERNAL = /^(https?|mailto|tel|ftp|sms|magnet):/i;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** foliate language maps ({en: 'x'}) and contributor objects -> plain strings. */
const lm = (x: any): string => (typeof x === 'string' ? x : x && typeof x === 'object' ? String(Object.values(x)[0] ?? '') : '');
const names = (x: any): string[] =>
  ([] as any[]).concat(x ?? []).map((c) => (typeof c === 'string' ? c : lm(c?.name))).filter(Boolean);
const stripTags = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function seriesOf(raw: any): { name: string; index?: number } | undefined {
  const s = ([] as any[]).concat(raw ?? [])[0];
  const name = s && lm(s.name);
  return name ? { name, index: Number.isFinite(+s.position) ? +s.position : undefined } : undefined;
}

/** foliate-js mis-parses EPUB 3 series metadata (operator precedence), so read the OPF directly. */
function epubSeries(book: any): { name: string; index?: number } | undefined {
  const opf: Document | undefined = book?.resources?.opf;
  if (!opf) return undefined;
  const metas = Array.from(opf.getElementsByTagName('meta'));
  const num = (v: string | null | undefined) => (v && Number.isFinite(parseFloat(v)) ? parseFloat(v) : undefined);
  const cal = metas.find((m) => m.getAttribute('name') === 'calibre:series');
  if (cal?.getAttribute('content')) {
    return { name: cal.getAttribute('content')!, index: num(metas.find((m) => m.getAttribute('name') === 'calibre:series_index')?.getAttribute('content')) };
  }
  for (const m of metas.filter((x) => x.getAttribute('property') === 'belongs-to-collection')) {
    const ref = '#' + m.getAttribute('id');
    const refine = (p: string) => metas.find((x) => x.getAttribute('refines') === ref && x.getAttribute('property') === p)?.textContent;
    if (refine('collection-type') === 'series') return { name: (m.textContent ?? '').trim(), index: num(refine('group-position')) };
  }
  return undefined;
}

interface FlatToc {
  entry: TocEntry;
  item: any;
  section: number;
  start: number;
  end: number;
}

interface Resolved {
  index: number;
  anchor: ((doc: Document) => any) | number | undefined;
}

export interface ReflowOptions {
  /** Animate page turns (still off under prefers-reduced-motion). Default true. */
  animatePageTurns: boolean;
  /** Dim bitmaps slightly in dark themes. Default false. */
  dimImages: boolean;
}

export class ReflowEngine implements Engine {
  readonly kind = 'reflow' as const;

  private loaded: LoadedBook | null = null;
  private book: any = null;
  private sp: any = null;
  private handle: BookHandle | null = null;
  private flat: FlatToc[] = [];
  private tocIndex = new Map<any, number>();
  private sectionTitles: string[] = [];
  private language: string | undefined;

  private pres: Presentation = DEFAULT_PRESENTATION;
  private opts: ReflowOptions = { animatePageTurns: true, dimImages: false };
  private reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  private target: HTMLElement | null = null;
  private host: HTMLElement | null = null;
  private view: any = null;
  private renderer: any = null;
  private resizeObs: ResizeObserver | null = null;
  private lastAttrs: Record<string, string | boolean> = {};
  private renderChain: Promise<unknown> = Promise.resolve();

  private lastEvent: RelocatedEvent | null = null;
  private initialPending = false;
  private presentedAt = 0;
  private seq = 0;
  private disposed = false;

  private handlers = new Map<string, Set<(e: any) => void>>();
  private docCache = new Map<number, Document>();
  private maps = new WeakMap<Document, TextMap>();
  private decos = new Map<DecorationLayer, Map<string, Decoration>>();
  private drawn = new Set<string>();
  private cfiCache = new Map<string, Resolved | null>();
  private lastSelection: EngineSelection | null = null;
  private selTimer = 0;
  private wheelAcc = 0;
  private lastTurn = -Infinity;
  private fontCss = '';
  private chCache = new Map<string, number>();
  private resizeTimer = 0;
  private onMotion = () => this.applyLayout();

  // -------------------------------------------------------------------------------------------
  // open
  // -------------------------------------------------------------------------------------------

  async open(source: BookSource, options: OpenOptions = {}): Promise<BookHandle> {
    if (this.disposed) throw new EngineError('unknown', 'Engine disposed');
    const loaded = await loadBook(source, options.signal);
    if (this.disposed || options.signal?.aborted) {
      loaded.destroy();
      throw new EngineError('aborted');
    }
    this.loaded = loaded;
    this.book = loaded.book;
    const sections: any[] = this.book.sections;
    this.sp = new SectionProgress(sections, 1500, 1600);
    const m = this.book.metadata ?? {};
    this.language = ([] as any[]).concat(m.language ?? [])[0] || undefined;

    const toc = await this.buildToc();
    this.fillTocSpans();
    this.sectionTitles = this.computeSectionTitles();

    const series = epubSeries(this.book) ?? seriesOf(m.belongsTo?.series);
    const metadata: BookMetadata = {
      title: lm(m.title) || (source.kind === 'file' ? (source.fileName ?? '').replace(/\.[^.]+$/, '') : '') || 'Untitled',
      authors: names(m.author),
      language: this.language,
      publisher: lm(m.publisher?.name ?? m.publisher) || undefined,
      description: m.description ? stripTags(String(m.description)) : undefined,
      published: m.published ? String(m.published) : undefined,
      series,
      direction: this.book.dir === 'rtl' ? 'rtl' : this.book.dir === 'ltr' ? 'ltr' : undefined,
      cover: async () => {
        try {
          return (await this.book?.getCover?.()) ?? null;
        } catch {
          return null;
        }
      },
    };
    const fixed = this.book.rendition?.layout === 'pre-paginated';
    this.handle = {
      metadata,
      toc,
      layout: 'reflowable',
      hasText: true,
      wordCount: Math.round(this.sp.sizeTotal / BYTES_PER_WORD),
      capabilities: {
        selection: true, search: true, textStream: true, thumbnails: false, typography: !fixed, zoom: false,
        pageTint: false, spreads: true, flows: !fixed, ocr: false,
      },
    };
    return this.handle;
  }

  // -------------------------------------------------------------------------------------------
  // TOC / sections
  // -------------------------------------------------------------------------------------------

  private sectionBase(index: number): string {
    return this.book.sections[index]?.cfi ?? CFI.fake.fromIndex(index);
  }

  /** CFI of the start of a section's body (or of an element id inside it). */
  private startCfi(index: number, fragmentId?: string): string {
    const inner = fragmentId ? `epubcfi(/4/2[${fragmentId.replace(/[\^[\](),;=]/g, '^$&')}])` : 'epubcfi(/4)';
    return CFI.joinIndir(this.sectionBase(index), inner);
  }

  private cfiFor(index: number, range: Range): string {
    return CFI.joinIndir(this.sectionBase(index), CFI.fromRange(range));
  }

  private sectionFraction(index: number): number {
    return clamp01(this.sp.sectionFractions[index] ?? 0);
  }

  private async buildToc(): Promise<TocEntry[]> {
    this.flat = [];
    this.tocIndex.clear();
    const ids: any[] = this.book.sections.map((s: any) => s.id);
    const family = this.loaded!.family;
    const conv = async (items: any[] | undefined): Promise<TocEntry[]> => {
      const out: TocEntry[] = [];
      for (const item of items ?? []) {
        let section = -1;
        let frag: string | undefined;
        try {
          const [id, f] = (await this.book.splitTOCHref?.(item.href)) ?? [];
          section = ids.indexOf(id);
          frag = f;
        } catch {
          /* unresolvable entry: kept without a target section */
        }
        if (section < 0) {
          try {
            const r = await this.book.resolveHref?.(item.href);
            if (r && r.index >= 0) section = r.index;
          } catch {
            /* ignore */
          }
        }
        const entry: TocEntry = {
          title: String(item.label ?? '').trim() || '—',
          locator: {
            kind: 'reflow',
            cfi: section >= 0 ? this.startCfi(section, family !== 'fb2' && typeof frag === 'string' ? frag || undefined : undefined) : this.startCfi(0),
            fraction: section >= 0 ? this.sectionFraction(section) : 0,
          },
          children: [],
        };
        this.tocIndex.set(item, this.flat.length);
        this.flat.push({ entry, item, section, start: 0, end: 1 });
        entry.children = await conv(item.subitems);
        out.push(entry);
      }
      return out;
    };
    return conv(this.book.toc);
  }

  /** Chapter spans in whole-book fractions (section granularity). */
  private fillTocSpans() {
    const f = this.sp.sectionFractions as number[];
    this.flat.forEach((t, i) => {
      t.start = t.section >= 0 ? f[t.section]! : (this.flat[i - 1]?.end ?? 0);
      const next = this.flat.slice(i + 1).find((n) => n.section >= 0 && f[n.section]! > t.start);
      t.end = next ? f[next.section]! : t.section >= 0 && f[t.section + 1]! > t.start ? Math.max(f[t.section + 1]!, 0) : 1;
      if (!next && t.section >= 0) t.end = 1;
    });
  }

  private computeSectionTitles(): string[] {
    const n = this.book.sections.length;
    const titles = new Array<string>(n).fill('');
    let cur = '';
    const bySection = new Map<number, string>();
    for (const t of this.flat) if (t.section >= 0 && !bySection.has(t.section)) bySection.set(t.section, t.entry.title);
    for (let i = 0; i < n; i++) titles[i] = cur = bySection.get(i) ?? cur;
    return titles;
  }

  /** Landmarks (cover, toc, bodymatter...) if the book declares them. */
  getLandmarks(): Array<{ label: string; type: string[]; locator: Locator }> {
    return ((this.book?.landmarks ?? []) as any[])
      .map((l) => {
        const r = this.safeResolveHref(l.href);
        return r ? { label: String(l.label ?? ''), type: ([] as string[]).concat(l.type ?? []), locator: this.locatorAtSectionStart(r.index) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }

  /** Printed page list (EPUB page-list nav), if present. */
  getPageList(): Array<{ label: string; locator: Locator }> {
    return ((this.book?.pageList ?? []) as any[])
      .map((p) => {
        const r = this.safeResolveHref(p.href);
        return r ? { label: String(p.label ?? ''), locator: this.locatorAtSectionStart(r.index) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }

  private safeResolveHref(href: string): Resolved | null {
    try {
      const r = this.book.resolveHref?.(href);
      return r && !(r instanceof Promise) && r.index >= 0 ? r : null;
    } catch {
      return null;
    }
  }

  private locatorAtSectionStart(index: number): Locator {
    return { kind: 'reflow', cfi: this.startCfi(index), fraction: this.sectionFraction(index) };
  }

  /** Approximate chapter word counts and spans, for time-left estimates. */
  getChapters(): Array<{ title: string; start: number; end: number; words: number }> {
    const total = this.handle?.wordCount ?? 0;
    return this.flat.map((t) => ({ title: t.entry.title, start: t.start, end: t.end, words: Math.round((t.end - t.start) * total) }));
  }

  private chapterInfo(idx: number, fraction: number): ChapterInfo {
    const t = this.flat[idx]!;
    const span = Math.max(1e-9, t.end - t.start);
    return {
      index: idx,
      title: t.entry.title,
      fraction: clamp01((fraction - t.start) / span),
      words: Math.round(span * (this.handle?.wordCount ?? 0)),
    };
  }

  // -------------------------------------------------------------------------------------------
  // events
  // -------------------------------------------------------------------------------------------

  on<K extends keyof EngineEventMap>(type: K, handler: EngineEventHandler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as any);
    return () => void set!.delete(handler as any);
  }

  private emit<K extends keyof EngineEventMap>(type: K, event: EngineEventMap[K]): void {
    for (const h of [...(this.handlers.get(type) ?? [])]) {
      try {
        h(event);
      } catch (e) {
        console.error(`reflow: ${type} handler threw`, e);
      }
    }
  }

  private warn(e: unknown, code: 'unknown' | 'corrupt' = 'unknown') {
    this.emit('warning', e instanceof EngineError ? e : new EngineError(code, (e as Error)?.message, { cause: e }));
  }

  // -------------------------------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------------------------------

  render(target: HTMLElement, locator?: Locator): Promise<void> {
    const run = this.renderChain.then(() => this.doRender(target, locator));
    this.renderChain = run.catch(() => {});
    return run;
  }

  private async doRender(target: HTMLElement, locator?: Locator): Promise<void> {
    if (this.disposed) throw new EngineError('unknown', 'Engine disposed');
    if (!this.book) throw new EngineError('unknown', 'open() must be called before render()');
    await import('foliate-js/view.js');
    this.teardownView();
    this.target = target;

    const host = document.createElement('div');
    host.className = 'quire-reflow';
    host.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;contain:strict';
    target.append(host);
    this.host = host;
    this.applyHostStyle();

    const view: any = document.createElement('foliate-view');
    view.style.cssText = 'display:block;width:100%;height:100%';
    host.append(view);
    this.view = view;
    view.addEventListener('load', (e: CustomEvent) => this.onSectionLoad(e.detail));
    view.addEventListener('link', (e: CustomEvent) => this.onLink(e));
    view.addEventListener('external-link', (e: CustomEvent) => {
      e.preventDefault();
      this.emit('link', { href: e.detail.href, external: true });
    });
    view.addEventListener('create-overlay', () => this.drawDecorations());
    try {
      await view.open(this.book);
    } catch (e) {
      throw new EngineError('corrupt', (e as Error)?.message, { cause: e });
    }
    const renderer = (this.renderer = view.renderer);
    // foliate re-lays-out from a ResizeObserver; if that fires while a section iframe is still
    // parsing (document without <body> yet) it throws uncaught. The next load/resize re-renders.
    const paginatorRender = Object.getPrototypeOf(renderer).render;
    renderer.render = function (this: unknown) {
      try {
        return paginatorRender.call(this);
      } catch (e) {
        console.debug('reflow: layout skipped while a section was loading', e);
      }
    };
    renderer.addEventListener('relocate', (e: CustomEvent) => this.onRelocate(e.detail.reason));
    host.addEventListener('click', this.onHostClick);
    host.addEventListener('wheel', this.onWheel, { passive: false });
    this.reducedMotion?.addEventListener('change', this.onMotion);
    this.resizeObs = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.applyLayout(), 120);
    });
    this.resizeObs.observe(host);

    this.lastAttrs = {};
    this.applyStyles();
    this.applyLayout();

    this.initialPending = true;
    const resolved = (locator && this.resolveLocator(locator)) || { index: this.firstLinear(), anchor: 0 };
    await this.navigate(resolved);
    // Settle: events during the first layout are swallowed; publish one 'initial' with the final spot.
    this.initialPending = false;
    this.onRelocate('navigation', 'initial');
  }

  private teardownView() {
    clearTimeout(this.selTimer);
    clearTimeout(this.resizeTimer);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.reducedMotion?.removeEventListener('change', this.onMotion);
    this.host?.removeEventListener('click', this.onHostClick);
    this.host?.removeEventListener('wheel', this.onWheel);
    try {
      this.view?.close();
    } catch (e) {
      console.warn('reflow: view.close failed', e);
    }
    this.host?.remove();
    this.host = this.view = this.renderer = null;
    this.drawn.clear();
    this.lastEvent = null;
    this.lastSelection = null;
  }

  private firstLinear(): number {
    const i = this.book.sections.findIndex((s: any) => s.linear !== 'no');
    return Math.max(0, i);
  }

  private applyHostStyle() {
    const { theme } = this.pres;
    const s = this.host!.style;
    s.background = theme.bg;
    s.colorScheme = theme.dark ? 'dark' : 'light';
    s.setProperty('--overlayer-highlight-opacity', '1');
    s.setProperty('--overlayer-highlight-blend-mode', theme.dark ? 'screen' : 'multiply');
  }

  private applyStyles() {
    if (!this.renderer) return;
    this.fontCss ||= fontFaceCss(FONT_FILES, document.baseURI);
    this.renderer.setStyles(
      buildStyles({ theme: this.pres.theme, typography: this.pres.typography, dimImages: this.opts.dimImages, fontCss: this.fontCss }),
    );
  }

  private chPx(): number | undefined {
    const t = this.pres.typography;
    const stack = stackFor(t.fontFamily);
    if (!stack) return undefined;
    const key = `${stack}|${t.fontSize}|${t.fontWeight}`;
    let v = this.chCache.get(key);
    if (v === undefined) {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return undefined;
      ctx.font = `${t.fontWeight} ${t.fontSize}px ${stack}`;
      v = ctx.measureText('0').width;
      // Don't cache a measurement taken before the font loaded (fallback metrics).
      if (document.fonts?.check?.(ctx.font)) this.chCache.set(key, v);
    }
    return v > 0 ? v : undefined;
  }

  private applyLayout() {
    if (!this.renderer || !this.host) return;
    const p = this.pres;
    const a = layoutAttrs({
      typography: p.typography,
      flow: p.flow,
      spread: p.spread,
      width: this.host.clientWidth,
      height: this.host.clientHeight,
      chPx: this.chPx(),
      animate: this.opts.animatePageTurns && !this.reducedMotion?.matches,
    });
    const r = this.renderer as HTMLElement;
    // Set the attributes that matter first and `flow` last: each change re-lays-out the paginator.
    for (const k of ['gap', 'margin', 'max-inline-size', 'max-column-count', 'flow'] as const) {
      if (this.lastAttrs[k] !== a[k]) {
        r.setAttribute(k, a[k]);
        this.lastAttrs[k] = a[k];
      }
    }
    if (this.lastAttrs.animated !== a.animated) {
      r.toggleAttribute('animated', a.animated);
      this.lastAttrs.animated = a.animated;
    }
  }

  setPresentation(p: Partial<Presentation>): void {
    const prev = this.pres;
    this.pres = { ...prev, ...p };
    this.presentedAt = performance.now();
    if (!this.renderer || this.disposed) return;
    if (p.theme || p.typography) {
      this.applyHostStyle();
      this.applyStyles();
    }
    if (p.typography || p.flow || p.spread) this.applyLayout();
    if (p.theme) this.drawDecorations();
  }

  /** Engine-specific switches that are not part of Presentation. */
  setOptions(o: Partial<ReflowOptions>): void {
    this.opts = { ...this.opts, ...o };
    if (!this.renderer) return;
    this.applyLayout();
    if ('dimImages' in o) this.applyStyles();
  }

  // -------------------------------------------------------------------------------------------
  // navigation
  // -------------------------------------------------------------------------------------------

  private requireRenderer(): any {
    if (!this.renderer) throw new EngineError('not-rendered', 'render() must be called first');
    return this.renderer;
  }

  /** Locator -> {index, anchor}; CFI first, whole-book fraction as the fallback. */
  private resolveLocator(loc: Locator): Resolved | null {
    if (loc.kind !== 'reflow') return null;
    const n = this.book.sections.length;
    const safe = (r: Resolved): Resolved => ({
      index: r.index,
      anchor: typeof r.anchor === 'function' ? (doc: Document) => {
        try {
          return (r.anchor as any)(doc) ?? 0;
        } catch {
          return 0;
        }
      } : r.anchor,
    });
    const viaCfi = this.resolveCfi(loc.cfi);
    if (viaCfi && viaCfi.index >= 0 && viaCfi.index < n) return safe(viaCfi);
    if (typeof loc.fraction === 'number') {
      const [index, anchor] = this.sp.getSection(clamp01(loc.fraction));
      return { index, anchor };
    }
    return null;
  }

  private resolveCfi(cfi: string): Resolved | null {
    if (this.cfiCache.has(cfi)) return this.cfiCache.get(cfi)!;
    let r: Resolved | null = null;
    try {
      if (CFI.isCFI.test(cfi)) {
        if (this.book.resolveCFI) r = this.book.resolveCFI(cfi);
        else {
          const parts = CFI.parse(cfi);
          r = { index: CFI.fake.toIndex((parts.parent ?? parts).shift()), anchor: (doc: Document) => CFI.toRange(doc, parts) };
        }
      }
    } catch {
      r = null;
    }
    if (r && !(r.index >= 0)) r = null;
    this.cfiCache.set(cfi, r);
    return r;
  }

  private async navigate(r: Resolved, reason?: RelocatedEvent['reason']): Promise<void> {
    const renderer = this.requireRenderer();
    const seq = this.seq;
    if (reason) this.nextReason = reason;
    await renderer.goTo({ index: r.index, anchor: r.anchor });
    if (seq === this.seq && !this.disposed) {
      // The paginator silently drops navigation while a page turn is settling (100 ms lock).
      await new Promise((res) => setTimeout(res, 130));
      if (seq === this.seq && this.renderer === renderer) await renderer.goTo({ index: r.index, anchor: r.anchor });
    }
  }
  private nextReason: RelocatedEvent['reason'] | null = null;

  async goTo(locator: Locator): Promise<void> {
    this.requireRenderer();
    const r = this.resolveLocator(locator);
    if (!r) throw new EngineError('unknown', 'Locator does not point into this book');
    await this.navigate(r, 'navigation');
  }

  async goToFraction(fraction: number): Promise<void> {
    this.requireRenderer();
    const [index, anchor] = this.sp.getSection(clamp01(fraction));
    await this.navigate({ index, anchor }, 'navigation');
  }

  private contents(): { index: number; doc: Document; overlayer?: any } | null {
    return this.renderer?.getContents()?.[0] ?? null;
  }

  /** Live section documents (for tests and shell features that need DOM access). */
  getContents(): Array<{ index: number; doc: Document }> {
    return (this.renderer?.getContents() ?? []).map((c: any) => ({ index: c.index, doc: c.doc }));
  }

  /** The text at the start of the visible page, for "you were here" cues and tests. */
  visibleText(max = 160): string {
    const range: Range | undefined = this.view?.lastLocation?.range;
    return range ? normaliseWs(range.toString()).slice(0, max) : '';
  }

  /**
   * Page turns queue behind the paginator's short post-turn lock instead of being dropped; a held
   * key can't build an unbounded backlog (extra requests beyond two in flight coalesce).
   */
  private turning = 0;
  private turnChain: Promise<unknown> = Promise.resolve();
  private turn(dir: 1 | -1): Promise<boolean> {
    this.requireRenderer();
    if (this.turning >= 3) return Promise.resolve(true);
    this.turning++;
    const run = this.turnChain.then(async () => {
      const r = this.renderer;
      if (!r || this.disposed) return false;
      if (dir > 0 ? this.atEnd() : this.atStart()) return false;
      this.nextReason = 'page-turn';
      await (dir > 0 ? r.next() : r.prev());
      return true;
    });
    this.turnChain = run.catch(() => {}).finally(() => void this.turning--);
    return run;
  }

  async next(): Promise<boolean> {
    return this.turn(1);
  }

  async prev(): Promise<boolean> {
    return this.turn(-1);
  }

  private atEnd(): boolean {
    const r = this.renderer;
    const c = this.contents();
    if (!r || !c) return false;
    const sections: any[] = this.book.sections;
    for (let i = c.index + 1; i < sections.length; i++) if (sections[i].linear !== 'no') return false;
    return r.scrolled ? r.viewSize - r.end <= 2 : r.page >= r.pages - 2;
  }

  private atStart(): boolean {
    const r = this.renderer;
    const c = this.contents();
    if (!r || !c) return false;
    const sections: any[] = this.book.sections;
    for (let i = c.index - 1; i >= 0; i--) if (sections[i].linear !== 'no') return false;
    return r.scrolled ? r.start <= 0 : r.page <= 1;
  }

  scrollBy(dy: number): void {
    const r = this.renderer;
    if (!r?.scrolled || !dy) return;
    if (dy > 0 && r.viewSize - r.end <= 2) void this.hop(1);
    else if (dy < 0 && r.start <= 0) void this.hop(-1);
    else r.containerPosition = r.containerPosition + dy;
  }

  private hop(dir: 1 | -1) {
    const t = performance.now();
    if (t - this.lastTurn < 350) return Promise.resolve();
    this.lastTurn = t;
    return (dir > 0 ? this.next() : this.prev()).catch((e) => this.warn(e));
  }

  getLocation(): RelocatedEvent | null {
    return this.lastEvent;
  }

  // -------------------------------------------------------------------------------------------
  // relocation
  // -------------------------------------------------------------------------------------------

  private onRelocate(foliateReason: string, force?: RelocatedEvent['reason']) {
    const loc = this.view?.lastLocation;
    if (!loc || !this.book) return;
    this.seq++;
    if (this.initialPending && !force) return;
    let reason: RelocatedEvent['reason'];
    if (this.nextReason && (foliateReason === 'navigation' || foliateReason === 'page' || foliateReason === 'snap' || foliateReason === 'selection')) {
      reason = this.nextReason;
      this.nextReason = null;
    } else if (foliateReason === 'navigation' || foliateReason === 'selection') reason = 'navigation';
    else if (foliateReason === 'page' || foliateReason === 'snap') reason = 'page-turn';
    else if (foliateReason === 'scroll') reason = 'scroll';
    else reason = performance.now() - this.presentedAt < 1500 ? 'presentation' : 'resize';
    if (force) {
      reason = force;
      this.nextReason = null;
    }

    let cfi: string;
    try {
      cfi = CFI.collapse(loc.cfi);
    } catch {
      cfi = loc.cfi;
    }
    const fraction = clamp01(loc.fraction);
    const prev = this.lastEvent;
    const same = prev && prev.locator.kind === 'reflow' && prev.locator.cfi === cfi && Math.abs(prev.locator.fraction - fraction) < 1e-6;
    if (same && (reason === 'resize' || reason === 'presentation')) {
      this.emit('layout', undefined);
      return;
    }
    const idx = loc.tocItem ? (this.tocIndex.get(loc.tocItem) ?? -1) : -1;
    const progress: Progress = {
      fraction,
      chapter: idx >= 0 ? this.chapterInfo(idx, fraction) : undefined,
      location: loc.location ? { index: loc.location.current, count: loc.location.total } : undefined,
    };
    const ev: RelocatedEvent = { locator: { kind: 'reflow', cfi, fraction }, progress, reason };
    this.lastEvent = ev;
    this.emit('relocated', ev);
    this.emit('layout', undefined);
    if (this.lastSelection) this.scheduleSelection();
  }

  // -------------------------------------------------------------------------------------------
  // section documents: key forwarding, wheel, clicks, selection, links
  // -------------------------------------------------------------------------------------------

  private onSectionLoad({ doc }: { doc: Document }) {
    for (const type of KEY_EVENTS) {
      doc.addEventListener(type, (e) => {
        const ke = e as KeyboardEvent;
        const copy = new KeyboardEvent(type, {
          key: ke.key, code: ke.code, location: ke.location, repeat: ke.repeat, isComposing: ke.isComposing,
          ctrlKey: ke.ctrlKey, shiftKey: ke.shiftKey, altKey: ke.altKey, metaKey: ke.metaKey,
          keyCode: ke.keyCode, charCode: ke.charCode, bubbles: true, cancelable: true,
        });
        const host = this.host;
        if (host && !host.dispatchEvent(copy)) ke.preventDefault();
      });
    }
    doc.addEventListener('wheel', this.onWheel, { passive: false });
    doc.addEventListener('click', (e) => this.onDocClick(doc, e));
    doc.addEventListener('selectionchange', () => this.scheduleSelection());
    // Block native drag of images/links out of the page.
    doc.addEventListener('dragstart', (e) => e.preventDefault());
  }

  private onWheel = (e: WheelEvent) => {
    const r = this.renderer;
    if (!r || e.ctrlKey || this.disposed) return;
    const dy = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (r.scrolled) {
      // The browser scrolls the column; hop sections when it is pushed past an edge.
      if ((dy > 0 && r.viewSize - r.end <= 2) || (dy < 0 && r.start <= 0)) {
        e.preventDefault();
        if (Math.abs(dy) >= 4) void this.hop(dy > 0 ? 1 : -1);
      }
      return;
    }
    e.preventDefault();
    this.wheelAcc += dy;
    if (Math.abs(this.wheelAcc) < 40) return;
    const dir = this.wheelAcc > 0 ? 1 : -1;
    this.wheelAcc = 0;
    void this.hop(dir);
  };

  private rectToTarget(doc: Document, r: { left: number; top: number; width: number; height: number }): Rect {
    const fr = doc.defaultView?.frameElement?.getBoundingClientRect();
    const tr = this.target!.getBoundingClientRect();
    return { x: r.left + (fr?.left ?? 0) - tr.left, y: r.top + (fr?.top ?? 0) - tr.top, width: r.width, height: r.height };
  }

  private rangeRects(doc: Document, range: Range): Rect[] {
    return Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => this.rectToTarget(doc, r));
  }

  private onDocClick(doc: Document, e: MouseEvent) {
    const sel = doc.getSelection();
    if (sel && !sel.isCollapsed) return;
    const t = e.target as Element | null;
    if (t?.closest?.('a[href]')) return;
    const c = this.contents();
    const [key, range] = c?.overlayer?.hitTest(e) ?? [];
    if (typeof key === 'string' && key.startsWith('annotations:')) {
      const rects = range ? this.rangeRects(doc, range) : [];
      const rect = rects[0] ?? { x: e.clientX, y: e.clientY, width: 0, height: 0 };
      this.emit('decorationclick', { layer: 'annotations', id: key.slice('annotations:'.length), rect });
      return;
    }
    const p = this.rectToTarget(doc, { left: e.clientX, top: e.clientY, width: 0, height: 0 });
    this.emitPointer(p.x, p.y, e.button);
  }

  private onHostClick = (e: MouseEvent) => {
    const tr = this.target!.getBoundingClientRect();
    this.emitPointer(e.clientX - tr.left, e.clientY - tr.top, e.button);
  };

  private emitPointer(x: number, y: number, button: number) {
    const w = this.target?.clientWidth || 1;
    this.emit('pointer', { x, y, zone: x < w * 0.3 ? 'left' : x > w * 0.7 ? 'right' : 'center', button });
  }

  // --- links and footnotes ---------------------------------------------------------------------

  private onLink(e: CustomEvent) {
    e.preventDefault(); // we navigate ourselves (history + footnote popups)
    const { a, href } = e.detail as { a: Element; href: string };
    this.handleLink(a, href).catch((err) => this.warn(err));
  }

  private async handleLink(a: Element, href: string) {
    if (EXTERNAL.test(href)) {
      this.emit('link', { href, external: true });
      return;
    }
    let resolved: Resolved | null = null;
    try {
      resolved = (await this.book.resolveHref(href)) ?? null;
    } catch {
      resolved = null;
    }
    if (!resolved || !(resolved.index >= 0)) {
      this.emit('link', { href, external: false });
      return;
    }
    const ref = noteRefKind(a);
    if (ref.yes || ref.maybe()) {
      const note = await this.extractNote(resolved, ref.yes);
      if (note) {
        const doc = a.ownerDocument;
        this.emit('footnote', {
          html: note,
          rect: this.rectToTarget(doc, a.getBoundingClientRect()),
          target: await this.locatorFor(resolved),
        });
        return;
      }
    }
    const target = await this.locatorFor(resolved);
    this.emit('link', { href, external: false, target });
    await this.navigate(resolved, 'navigation');
  }

  private async extractNote(r: Resolved, explicit: boolean): Promise<string | null> {
    try {
      const doc = await this.parsedDoc(r.index);
      const target = typeof r.anchor === 'function' ? r.anchor(doc) : null;
      const el = noteElement(target || null);
      if (!el) return null;
      if (!explicit) {
        // A superscript link is only a note if its target looks like one.
        const looksLikeNote = referencedType(el) || (el.matches('li, aside, p') && (el.textContent ?? '').length <= 1500);
        if (!looksLikeNote || el === doc.body) return null;
      }
      const html = sanitizeNote(el);
      return stripTags(html) ? html : null;
    } catch {
      return null;
    }
  }

  private async locatorFor(r: Resolved): Promise<Locator> {
    try {
      const doc = await this.parsedDoc(r.index);
      const a = typeof r.anchor === 'function' ? r.anchor(doc) : null;
      if (a) {
        const range = 'startContainer' in a ? (a as Range) : doc.createRange();
        if (!('startContainer' in a)) range.selectNodeContents(a as Element);
        range.collapse(true);
        const map = this.mapFor(doc);
        const at = textOffsetOf(map, range.startContainer, range.startOffset);
        return { kind: 'reflow', cfi: this.cfiFor(r.index, range), fraction: this.fractionAt(r.index, map, at) };
      }
    } catch {
      /* fall through to the section start */
    }
    return this.locatorAtSectionStart(r.index);
  }

  // -------------------------------------------------------------------------------------------
  // parsed documents (headless): search, text, streams, fuzzy anchors
  // -------------------------------------------------------------------------------------------

  private async parsedDoc(index: number): Promise<Document> {
    const hit = this.docCache.get(index);
    if (hit) {
      this.docCache.delete(index);
      this.docCache.set(index, hit);
      return hit;
    }
    const section = this.book.sections[index];
    if (!section?.createDocument) throw new EngineError('unknown', `Section ${index} has no document`);
    const doc: Document = await section.createDocument();
    this.docCache.set(index, doc);
    while (this.docCache.size > 5) this.docCache.delete(this.docCache.keys().next().value as number);
    return doc;
  }

  private mapFor(doc: Document): TextMap {
    let m = this.maps.get(doc);
    if (!m) this.maps.set(doc, (m = buildTextMap(doc.body ?? doc.documentElement)));
    return m;
  }

  private fractionAt(index: number, map: TextMap, at: number): number {
    const f0 = this.sectionFraction(index);
    const f1 = clamp01(this.sp.sectionFractions[index + 1] ?? 1);
    return clamp01(f0 + (f1 - f0) * (at / Math.max(1, map.text.length)));
  }

  /** Anchor for text span [s, e) of a section's map (parsed or live doc). */
  private anchorForSpan(index: number, doc: Document, map: TextMap, s: number, e: number): Anchor | null {
    const range = rangeOfText(map, doc, s, e);
    return range ? this.anchorFromRange(index, doc, map, range, s, e) : null;
  }

  private anchorFromRange(index: number, doc: Document, map: TextMap, range: Range, s?: number, e?: number): Anchor {
    s ??= textOffsetOf(map, range.startContainer, range.startOffset);
    e ??= textOffsetOf(map, range.endContainer, range.endOffset, true);
    const cfiRange = this.cfiFor(index, range);
    let start = cfiRange;
    try {
      start = CFI.collapse(cfiRange);
    } catch {
      /* keep the range CFI */
    }
    void doc;
    return {
      locator: { kind: 'reflow', cfi: start, fraction: this.fractionAt(index, map, s) },
      quote: {
        exact: map.text.slice(s, e),
        prefix: map.text.slice(Math.max(0, s - 32), s),
        suffix: map.text.slice(e, e + 32),
      },
      cfiRange,
    };
  }

  async *search(query: string, options: SearchOptions = {}): AsyncIterable<SearchHit> {
    if (!this.book || !query.trim()) return;
    const matcher = searchMatcher(textWalker, {
      defaultLocale: this.language,
      matchCase: !!options.caseSensitive,
      matchWholeWords: !!options.wholeWord,
    });
    const sections: any[] = this.book.sections;
    for (let i = 0; i < sections.length; i++) {
      if (options.signal?.aborted || this.disposed) return;
      if (!sections[i].createDocument) continue;
      let doc: Document;
      try {
        doc = await this.parsedDoc(i);
      } catch (e) {
        this.warn(e, 'corrupt');
        continue;
      }
      const map = this.mapFor(doc);
      for (const { range, excerpt } of matcher(doc, query)) {
        if (options.signal?.aborted || this.disposed) return;
        let cfiRange: string;
        try {
          cfiRange = this.cfiFor(i, range);
        } catch {
          continue;
        }
        const at = textOffsetOf(map, range.startContainer, range.startOffset);
        let start = cfiRange;
        try {
          start = CFI.collapse(cfiRange);
        } catch {
          /* keep */
        }
        yield {
          locator: { kind: 'reflow', cfi: start, fraction: this.fractionAt(i, map, at) },
          excerpt: { before: excerpt.pre, match: excerpt.match, after: excerpt.post },
          anchor: {
            locator: { kind: 'reflow', cfi: start, fraction: this.fractionAt(i, map, at) },
            quote: { exact: excerpt.match, prefix: excerpt.pre.slice(-32), suffix: excerpt.post.slice(0, 32) },
            cfiRange,
          },
          section: this.sectionTitles[i] || undefined,
        };
      }
      await tick(); // keep the UI thread breathing between sections
    }
  }

  async getText(range: TextRange): Promise<string> {
    if (!this.book) throw new EngineError('unknown', 'open() first');
    const a = this.resolveLocator(range.from);
    const b = this.resolveLocator(range.to);
    if (!a || !b) throw new EngineError('unknown', 'Locator does not point into this book');
    const [first, last] = a.index <= b.index ? [a, b] : [b, a];
    const out: string[] = [];
    for (let i = first.index; i <= last.index; i++) {
      if (!this.book.sections[i]?.createDocument) continue;
      const doc = await this.parsedDoc(i);
      const map = this.mapFor(doc);
      const offsetOf = (r: Resolved) => {
        const x = typeof r.anchor === 'function' ? r.anchor(doc) : null;
        if (x && 'startContainer' in x) return textOffsetOf(map, x.startContainer, x.startOffset);
        if (x?.nodeType === 1) return textOffsetOf(map, x, 0);
        return typeof r.anchor === 'number' ? Math.round(r.anchor * map.text.length) : 0;
      };
      const s = i === first.index ? offsetOf(first) : 0;
      const e = i === last.index ? offsetOf(last) : map.text.length;
      const text = map.text.slice(s, Math.max(s, e)).trim();
      if (text) out.push(text);
    }
    return out.join('\n');
  }

  async *textStream(from?: Locator, options: TextStreamOptions = {}): AsyncIterable<TextChunk> {
    if (!this.book) throw new EngineError('unknown', 'open() first');
    const max = options.maxChunkChars ?? 400;
    const origin = from ?? this.lastEvent?.locator;
    const start = origin ? this.resolveLocator(origin) : null;
    const sections: any[] = this.book.sections;
    for (let i = start?.index ?? this.firstLinear(); i < sections.length; i++) {
      if (options.signal?.aborted || this.disposed) return;
      if (sections[i].linear === 'no' || !sections[i].createDocument) continue;
      const doc = await this.parsedDoc(i);
      const map = this.mapFor(doc);
      let min = 0;
      if (start && i === start.index) {
        try {
          const x = typeof start.anchor === 'function' ? start.anchor(doc) : null;
          if (x && 'startContainer' in x) min = textOffsetOf(map, x.startContainer, x.startOffset);
          else if (typeof start.anchor === 'number') min = Math.round(start.anchor * map.text.length);
        } catch {
          min = 0;
        }
      }
      const index = i;
      for (const [a0, b] of chunkSentences(map.text, this.language, max)) {
        if (b <= min) continue;
        const a = Math.max(a0, min);
        const loc = (off: number, end: boolean): Locator => {
          const r = rangeOfText(map, doc, end ? off - 1 : off, end ? off : off + 1);
          if (!r) return this.locatorAtSectionStart(index);
          r.collapse(!end);
          return { kind: 'reflow', cfi: this.cfiFor(index, r), fraction: this.fractionAt(index, map, off) };
        };
        yield {
          text: map.text.slice(a, b),
          locator: loc(a, false),
          end: loc(b, true),
          anchorFor: async (s, e) => this.anchorForSpan(index, doc, map, a + s, a + e),
        };
        if (options.signal?.aborted) return;
      }
      await tick();
    }
  }

  // -------------------------------------------------------------------------------------------
  // selection and anchors
  // -------------------------------------------------------------------------------------------

  private scheduleSelection() {
    clearTimeout(this.selTimer);
    this.selTimer = window.setTimeout(() => this.refreshSelection(), 90);
  }

  private computeSelection(sel?: Selection | null): EngineSelection | null {
    const c = this.contents();
    if (!c) return null;
    const s = sel ?? c.doc.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return null;
    const range = s.getRangeAt(0);
    const doc = range.startContainer.ownerDocument ?? c.doc;
    const text = range.toString();
    if (!text.trim()) return null;
    const map = this.mapFor(doc);
    return {
      anchor: this.anchorFromRange(c.index, doc, map, range),
      text,
      rects: this.rangeRects(doc, range),
    };
  }

  private refreshSelection() {
    if (this.disposed || !this.renderer) return;
    let next: EngineSelection | null = null;
    try {
      next = this.computeSelection();
    } catch (e) {
      this.warn(e);
    }
    if (!next && !this.lastSelection) return;
    this.lastSelection = next;
    this.emit('selection', next);
  }

  getSelection(): EngineSelection | null {
    try {
      return this.computeSelection();
    } catch {
      return null;
    }
  }

  async selectionToAnchor(selection?: Selection | null): Promise<Anchor | null> {
    try {
      return this.computeSelection(selection)?.anchor ?? null;
    } catch {
      return null;
    }
  }

  clearSelection(): void {
    for (const c of this.renderer?.getContents() ?? []) c.doc.getSelection()?.removeAllRanges();
    if (this.lastSelection) {
      this.lastSelection = null;
      this.emit('selection', null);
    }
  }

  async anchorToRanges(anchor: Anchor): Promise<ResolvedAnchor | null> {
    if (!this.book) return null;
    const cfi = anchor.cfiRange ?? (anchor.locator.kind === 'reflow' ? anchor.locator.cfi : '');
    const quote = anchor.quote;
    const shown = this.contents();
    const via = (cfi && this.resolveCfi(cfi)) || (anchor.locator.kind === 'reflow' ? this.resolveLocator(anchor.locator) : null);
    let index = via?.index ?? -1;
    let exact = false;
    let range: Range | null = null;
    let doc: Document | null = null;

    const live = (i: number) => !!shown && shown.index === i;
    const docFor = async (i: number) => (live(i) ? shown!.doc : this.parsedDoc(i));

    if (via && index >= 0 && typeof via.anchor === 'function') {
      try {
        doc = await docFor(index);
        const r = via.anchor(doc);
        if (r && 'startContainer' in r) {
          range = r;
          const got = normaliseWs(r.toString());
          exact = !quote.exact || got === normaliseWs(quote.exact);
        }
      } catch {
        range = null;
      }
    }

    let updated: Anchor | undefined;
    if (!exact) {
      // Fuzzy: look for the quote in the expected section, then its neighbours.
      const nearFraction = anchor.locator.kind === 'reflow' ? anchor.locator.fraction : 0;
      const guess = index >= 0 ? index : this.sp.getSection(clamp01(nearFraction))[0];
      const order = [guess, guess + 1, guess - 1, guess + 2, guess - 2].filter((i) => i >= 0 && i < this.book.sections.length);
      range = null;
      for (const i of order) {
        if (!this.book.sections[i]?.createDocument) continue;
        const d = await docFor(i);
        const map = this.mapFor(d);
        const hit = findQuote(map.text, quote, Math.round((map.text.length * (nearFraction - this.sectionFraction(i))) / Math.max(1e-9, (this.sp.sectionFractions[i + 1] ?? 1) - this.sectionFraction(i))));
        if (!hit) continue;
        const r = rangeOfText(map, d, hit[0], hit[1]);
        if (!r) continue;
        range = r;
        doc = d;
        index = i;
        updated = this.anchorFromRange(i, d, map, r, hit[0], hit[1]);
        break;
      }
      if (!range) return null;
    }

    const regions: AnchorRegion[] = [];
    if (range && doc && live(index)) {
      const rects = this.rangeRects(doc, range).filter((r) => this.visibleRect(r));
      if (rects.length) regions.push({ rects, range });
    }
    return { regions, exact, updated };
  }

  private visibleRect(r: Rect): boolean {
    const w = this.target?.clientWidth ?? 0;
    const h = this.target?.clientHeight ?? 0;
    return r.x + r.width > 0 && r.x < w && r.y + r.height > 0 && r.y < h;
  }

  // -------------------------------------------------------------------------------------------
  // decorations and speech
  // -------------------------------------------------------------------------------------------

  setDecorations(layer: DecorationLayer, items: Decoration[]): void {
    this.decos.set(layer, new Map(items.map((d) => [d.id, d])));
    this.drawDecorations();
  }

  private drawDecorations() {
    const c = this.contents();
    if (!c?.overlayer) return;
    for (const key of this.drawn) c.overlayer.remove(key);
    this.drawn.clear();
    for (const [layer, items] of this.decos) {
      for (const d of items.values()) {
        const cfi = d.anchor.cfiRange ?? (d.anchor.locator.kind === 'reflow' ? d.anchor.locator.cfi : '');
        const r = cfi ? this.resolveCfi(cfi) : null;
        if (!r || r.index !== c.index || typeof r.anchor !== 'function') continue;
        let range: any;
        try {
          range = r.anchor(c.doc);
        } catch {
          continue;
        }
        if (typeof range?.getClientRects !== 'function') continue;
        const spec = drawFor(d.style, this.pres.theme);
        const key = `${layer}:${d.id}`;
        try {
          c.overlayer.add(key, range, spec.draw, spec.options);
          this.drawn.add(key);
        } catch (e) {
          this.warn(e);
        }
      }
    }
  }

  /**
   * Read-aloud: draw the spoken word (and optionally its sentence) and make sure it is on screen,
   * turning the page when needed. Get anchors from `TextChunk.anchorFor(start, end)`; pass null to
   * clear. Call on every boundary event.
   */
  async showSpeech(word: Anchor | null, sentence?: Anchor | null): Promise<void> {
    const items: Decoration[] = [];
    if (sentence) items.push({ id: 'sentence', anchor: sentence, style: { type: 'speech-sentence' } });
    if (word) items.push({ id: 'word', anchor: word, style: { type: 'speech-word' } });
    this.setDecorations('speech', items);
    const focus = word ?? sentence;
    if (!focus || !this.renderer) return;
    const r = (focus.cfiRange && this.resolveCfi(focus.cfiRange)) || null;
    if (!r) return;
    const c = this.contents();
    if (c && c.index === r.index) {
      const range = typeof r.anchor === 'function' ? r.anchor(c.doc) : null;
      if (range && 'getClientRects' in range && this.rangeRects(c.doc, range).some((x) => this.visibleRect(x))) return;
    }
    await this.navigate(r, 'navigation');
  }

  clearSpeech(): void {
    this.setDecorations('speech', []);
  }

  // -------------------------------------------------------------------------------------------
  // teardown
  // -------------------------------------------------------------------------------------------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardownView();
    try {
      this.loaded?.destroy();
    } catch (e) {
      console.warn('reflow: destroy failed', e);
    }
    this.loaded = this.book = this.handle = this.sp = null;
    this.docCache.clear();
    this.decos.clear();
    this.cfiCache.clear();
    this.handlers.clear();
  }
}
