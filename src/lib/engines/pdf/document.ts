import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { EngineError } from '../types';
import type { Anchor, BookHandle, BookMetadata, BookSource, Locator, OcrWord, OpenOptions, SearchHit, SearchOptions, TextChunk, TextRange, TextStreamOptions, TocEntry } from '../types';
import { ByteLru } from './lru';
import { PDF_TO_CSS, chapterIndex, type Size } from './layout';
import { dataUrl, setupPdfjs } from './setup';
import { buildPageText, findAll, makeQuote, normalizeQuery, quadsFor, splitBlocks, type Measure, type PageText } from './textindex';

export interface PageInfo extends Size {
  /** Intrinsic /Rotate of the page. */
  rotate: number;
  /** MediaBox/CropBox in PDF user space. */
  view: number[];
}
export type PT = PageText & { w: number; h: number };

export interface FlatToc {
  title: string;
  page: number;
  y: number;
}

/** Map any pdf.js failure to a typed EngineError. Never throws. */
export function mapError(e: unknown): EngineError {
  if (e instanceof EngineError) return e;
  const name = (e as { name?: string })?.name ?? '';
  const msg = (e as { message?: string })?.message ?? String(e);
  if (name === 'PasswordException') return new EngineError('password-required', msg, { cause: e });
  if (name === 'AbortException' || name === 'RenderingCancelledException') return new EngineError('aborted', msg, { cause: e });
  if (name === 'InvalidPDFException' || name === 'FormatError' || name === 'XRefParseException' || /invalid pdf|missing pdf|unexpected server response \(0\)/i.test(msg)) return new EngineError('corrupt', msg, { cause: e });
  if (name === 'ResponseException' || name === 'UnexpectedResponseException' || /network|fetch|NetworkError/i.test(msg)) return new EngineError('network', msg, { cause: e });
  return new EngineError('unknown', msg, { cause: e });
}

const CHUNK = 1 << 18;
const MAX_RANGE_RETRIES = 2;

/** Fetch exactly [begin, end) with Range requests; copes with servers (quire://) that answer fewer bytes than asked. */
async function fetchRange(url: string, begin: number, end: number, signal?: AbortSignal): Promise<Uint8Array> {
  const out = new Uint8Array(end - begin);
  let got = 0;
  let retries = 0;
  while (got < out.length) {
    const res = await fetch(url, { headers: { Range: `bytes=${begin + got}-${end - 1}` }, signal, cache: 'no-store' });
    if (res.status !== 206 && !(res.status === 200 && begin + got === 0)) throw new EngineError('network', `Range request failed (${res.status})`);
    const part = new Uint8Array(await res.arrayBuffer()).subarray(0, out.length - got);
    if (!part.length && ++retries > MAX_RANGE_RETRIES) throw new EngineError('network', 'Empty range response');
    out.set(part, got);
    got += part.length;
  }
  return out;
}

/**
 * Our own range transport instead of pdf.js's URL loader: the first request learns the total size
 * from Content-Range (the quire:// protocol answers a Range-less request with only a 16 MB slice,
 * which pdf.js would mistake for the whole file) and every later request is an explicit small range.
 */
async function rangeTransport(pdfjs: ReturnType<typeof setupPdfjs>, url: string, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Range: `bytes=0-${CHUNK - 1}` }, signal, cache: 'no-store' });
  } catch (e) {
    throw (e as Error)?.name === 'AbortError' ? new EngineError('aborted') : new EngineError('network', (e as Error)?.message, { cause: e });
  }
  if (!res.ok) throw new EngineError('network', `Could not read the file (${res.status})`);
  const first = new Uint8Array(await res.arrayBuffer());
  const total = /\/(\d+)\s*$/.exec(res.headers.get('Content-Range') ?? '')?.[1];
  const length = total ? Number(total) : first.length;
  const transport = new pdfjs.PDFDataRangeTransport(length, first.length >= length ? first : first.subarray(0, Math.min(first.length, length)));
  transport.requestDataRange = (begin: number, end: number) => {
    fetchRange(url, begin, Math.min(end, length), signal).then(
      (data) => transport.onDataRange(begin, data),
      (e) => console.warn('[pdf-engine] range request failed', e),
    );
  };
  return transport;
}

export const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export class PdfDoc {
  pageCount = 0;
  infos: (PageInfo | undefined)[] = [];
  est!: PageInfo;
  toc: TocEntry[] = [];
  flat: FlatToc[] = [];
  labels?: string[];
  ocr = new Map<number, OcrWord[]>();
  private texts = new ByteLru<number, PT>(48 * 1024 * 1024);
  private pending = new Map<number, Promise<PT>>();
  private infoPending = new Map<number, Promise<PageInfo>>();
  private thumbs = new ByteLru<string, ImageBitmap>(32 * 1024 * 1024, (_k, b) => b.close());
  private thumbQueue: Promise<unknown> = Promise.resolve();
  private destroyed = false;

  private constructor(readonly pdf: PDFDocumentProxy) {
    this.pageCount = pdf.numPages;
  }

  static async open(source: BookSource, options: OpenOptions = {}): Promise<{ doc: PdfDoc; handle: BookHandle }> {
    if (source.kind !== 'file' || source.format !== 'pdf') throw new EngineError('unsupported-format', 'The PDF engine only opens PDF files.');
    if (options.signal?.aborted) throw new EngineError('aborted');
    const pdfjs = setupPdfjs();
    const range = await rangeTransport(pdfjs, source.url, options.signal);
    const task = pdfjs.getDocument({
      range,
      rangeChunkSize: 1 << 18,
      disableAutoFetch: true,
      cMapUrl: dataUrl('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: dataUrl('standard_fonts'),
      wasmUrl: dataUrl('wasm'),
      iccUrl: dataUrl('iccs'),
      useWorkerFetch: true,
      enableXfa: false,
    });
    let failure: EngineError | undefined;
    task.onPassword = (update: (pw: string) => void, reason: number) => {
      void (async () => {
        if (!options.requestPassword) {
          failure = new EngineError('password-required', 'This document is password protected.');
          void task.destroy();
          return;
        }
        let pw: string | null = null;
        try {
          pw = await options.requestPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
        } catch {
          pw = null;
        }
        if (pw === null) {
          failure = new EngineError('password-cancelled');
          void task.destroy();
        } else update(pw);
      })();
    };
    options.signal?.addEventListener('abort', () => {
      failure ??= new EngineError('aborted');
      void task.destroy();
    });
    let pdf: PDFDocumentProxy;
    try {
      pdf = await task.promise;
    } catch (e) {
      void task.destroy().catch(() => {});
      throw failure ?? mapError(e);
    }
    const doc = new PdfDoc(pdf);
    try {
      doc.est = await doc.info(0);
      const [metadata, labels] = await Promise.all([doc.readMetadata(source), pdf.getPageLabels().catch(() => null)]);
      if (labels && labels.length === doc.pageCount) doc.labels = labels;
      await doc.readToc().catch(() => {});
      const hasText = await doc.sampleHasText();
      metadata.cover = () => doc.cover();
      return {
        doc,
        handle: {
          metadata,
          toc: doc.toc,
          layout: 'fixed',
          hasText,
          pageCount: doc.pageCount,
          pageLabels: doc.labels,
          capabilities: { selection: true, search: true, textStream: true, thumbnails: true, typography: false, zoom: true, pageTint: true, spreads: true, flows: true, ocr: true },
        },
      };
    } catch (e) {
      doc.destroy();
      throw mapError(e);
    }
  }

  private async readMetadata(source: Extract<BookSource, { kind: 'file' }>): Promise<BookMetadata> {
    const m = await this.pdf.getMetadata().catch(() => null);
    const info = (m?.info ?? {}) as Record<string, unknown>;
    const xmp = m?.metadata as { get(k: string): unknown } | null | undefined;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const fromName = source.fileName?.replace(/\.pdf$/i, '');
    const authors = str(info.Author) ?? str(xmp?.get('dc:creator'));
    return {
      title: str(info.Title) ?? str(xmp?.get('dc:title')) ?? fromName ?? 'Untitled',
      authors: authors ? authors.split(/\s*[;,&]\s*|\s+and\s+/).filter(Boolean) : [],
      language: str(info.Language) ?? str(xmp?.get('dc:language')),
      publisher: str(xmp?.get('dc:publisher')),
      description: str(info.Subject) ?? str(xmp?.get('dc:description')),
    };
  }

  /** Samples up to five pages spread across the document; scans have no text on any of them. */
  private async sampleHasText(): Promise<boolean> {
    const n = this.pageCount;
    const idx = [...new Set([0, 1, 2, 3, 4].map((k) => Math.min(n - 1, Math.floor((k * n) / 5))))];
    const counts = await Promise.all(idx.map((i) => this.pageText(i).then((t) => t.text.trim().length).catch(() => 0)));
    return counts.reduce((a, b) => a + b, 0) >= 10;
  }

  proxy(page: number): Promise<PDFPageProxy> {
    return this.pdf.getPage(page + 1);
  }

  info(page: number): Promise<PageInfo> {
    const known = this.infos[page];
    if (known) return Promise.resolve(known);
    let p = this.infoPending.get(page);
    if (!p) {
      p = this.proxy(page).then((pg) => {
        const vp = pg.getViewport({ scale: PDF_TO_CSS, rotation: pg.rotate });
        const info: PageInfo = { w: vp.width, h: vp.height, rotate: pg.rotate, view: pg.view };
        this.infos[page] = info;
        this.infoPending.delete(page);
        return info;
      });
      this.infoPending.set(page, p);
    }
    return p;
  }

  /** Page height in PDF points, with the unrotated page-space orientation used by quads. */
  pageSpace(page: number): { w: number; h: number } {
    const v = (this.infos[page] ?? this.est).view;
    return { w: v[2] - v[0], h: v[3] - v[1] };
  }

  // ---- TOC -------------------------------------------------------------------------------------

  private async readToc(): Promise<void> {
    const outline = await this.pdf.getOutline();
    if (!outline) return;
    const unresolved = new Set<TocEntry>();
    type Node = { title: string; dest: unknown; items?: Node[] };
    const resolve = async (dest: unknown): Promise<{ page: number; y: number } | null> => {
      try {
        const d = typeof dest === 'string' ? await this.pdf.getDestination(dest) : (dest as unknown[] | null);
        if (!Array.isArray(d)) return null;
        const ref = d[0];
        const page = typeof ref === 'number' ? ref : await this.pdf.getPageIndex(ref as never);
        const kind = (d[1] as { name?: string } | null)?.name;
        const top = kind === 'XYZ' ? d[3] : kind === 'FitH' || kind === 'FitBH' ? d[2] : null;
        let y = 0;
        if (typeof top === 'number') {
          const info = await this.info(page);
          const h = info.view[3] - info.view[1];
          y = Math.min(1, Math.max(0, (info.view[3] - top) / h));
        }
        return { page, y };
      } catch {
        return null;
      }
    };
    const walk = async (nodes: Node[]): Promise<TocEntry[]> => {
      const entries = await Promise.all(
        nodes.map(async (n) => {
          const loc = n.dest ? await resolve(n.dest) : null;
          return { n, loc };
        }),
      );
      const out: TocEntry[] = [];
      for (const { n, loc } of entries) {
        const entry: TocEntry = { title: n.title.trim() || 'Untitled', locator: { kind: 'fixed', page: loc?.page ?? 0, y: loc?.y }, children: [] };
        if (!loc) unresolved.add(entry);
        out.push(entry);
      }
      for (let i = 0; i < out.length; i++) out[i].children = await walk(entries[i].n.items ?? []);
      return out;
    };
    this.toc = await walk(outline as Node[]);
    // Pre-order, matching how the shell flattens `toc`; unresolved entries inherit the previous position.
    const flat: FlatToc[] = [];
    const rec = (entries: TocEntry[]) => {
      for (const e of entries) {
        const loc = e.locator as { page: number; y?: number };
        const prev = flat[flat.length - 1];
        flat.push(unresolved.has(e) ? { title: e.title, page: prev?.page ?? 0, y: prev?.y ?? 0 } : { title: e.title, page: loc.page, y: loc.y ?? 0 });
        rec(e.children);
      }
    };
    rec(this.toc);
    this.flat = flat;
  }

  /** The flattened-TOC entry containing (page, y). */
  chapterAt(page: number, y: number): { index: number; title: string } | undefined {
    const i = chapterIndex(this.flat, page, y);
    return i < 0 ? undefined : { index: i, title: this.flat[i].title };
  }

  // ---- Text ------------------------------------------------------------------------------------

  pageText(page: number): Promise<PT> {
    const hit = this.texts.get(page);
    if (hit) return Promise.resolve(hit);
    let p = this.pending.get(page);
    if (!p) {
      p = this.buildText(page)
        .then((pt) => {
          this.texts.set(page, pt, pt.text.length * 2 + pt.items.length * 64 + 256);
          return pt;
        })
        .finally(() => this.pending.delete(page));
      this.pending.set(page, p);
    }
    return p;
  }

  private async buildText(page: number): Promise<PT> {
    const info = await this.info(page);
    const space = { w: info.view[2] - info.view[0], h: info.view[3] - info.view[1] };
    const words = this.ocr.get(page);
    if (words?.length) {
      let text = '';
      const items = words.map((w) => {
        const start = text.length;
        text += w.text + ' ';
        return { start, end: start + w.text.length, x: w.x, y: w.y, w: w.width, h: w.height };
      });
      return { text, items, ...space };
    }
    const pg = await this.proxy(page);
    const content = await pg.getTextContent({ includeMarkedContent: false, disableNormalization: false });
    const raw = content.items.filter((i): i is typeof i & { str: string } => 'str' in i);
    return { ...buildPageText(raw as never, info.view, this.measure(content.styles)), ...space };
  }

  private measureCtx: CanvasRenderingContext2D | null | undefined;
  private glyphW = new Map<string, number>();
  /** Per-character advances measured with the page font's CSS family (pdf.js text items only give the item's total width). */
  private measure(styles: Record<string, { fontFamily?: string }> | undefined): Measure {
    return (str, fontName) => {
      this.measureCtx ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
      const ctx = this.measureCtx;
      const fam = (fontName && styles?.[fontName]?.fontFamily) || 'sans-serif';
      if (!ctx) return null;
      ctx.font = `100px ${fam}`;
      const cum = [0];
      let sum = 0;
      for (const ch of str) {
        const key = `${fam}|${ch}`;
        let w = this.glyphW.get(key);
        if (w === undefined) this.glyphW.set(key, (w = ctx.measureText(ch).width));
        sum += w;
        for (let k = 1; k < ch.length; k++) cum.push(sum); // surrogate pairs count as two string indices
        cum.push(sum);
      }
      return sum > 0 ? cum.map((v) => v / sum) : null;
    };
  }

  setOcrWords(page: number, words: OcrWord[]): void {
    this.ocr.set(page, words);
    this.texts.delete(page);
  }

  async *search(query: string, options: SearchOptions = {}): AsyncGenerator<SearchHit> {
    const q = normalizeQuery(query, !!options.caseSensitive);
    if (!q) return;
    const AHEAD = 4;
    const ahead = new Map<number, Promise<PT | null>>();
    const load = (p: number) => {
      if (p < this.pageCount && !ahead.has(p)) ahead.set(p, this.pageText(p).catch(() => null));
    };
    for (let i = 0; i < AHEAD; i++) load(i);
    for (let page = 0; page < this.pageCount; page++) {
      if (options.signal?.aborted || this.destroyed) return;
      load(page + AHEAD);
      const pt = await ahead.get(page)!;
      ahead.delete(page);
      if (!pt) continue;
      for (const m of findAll(pt.text, q, options)) {
        const quads = quadsFor(pt, m.start, m.end);
        const c = { before: pt.text.slice(Math.max(0, m.start - 40), m.start), match: pt.text.slice(m.start, m.end), after: pt.text.slice(m.end, m.end + 40) };
        const y = quads.length ? Math.max(0, quads[0][1] / pt.h - 0.04) : 0;
        const locator: Locator = { kind: 'fixed', page, y };
        yield { locator, excerpt: c, anchor: { locator, quote: makeQuote(pt.text, m.start, m.end), pdfQuads: quads }, section: this.chapterAt(page, y)?.title };
      }
      if (page % 8 === 7) await tick(); // let the UI breathe
    }
  }

  async getText(range: TextRange): Promise<string> {
    const a = range.from.kind === 'fixed' ? range.from : { page: 0, y: 0 };
    const b = range.to.kind === 'fixed' ? range.to : { page: this.pageCount - 1, y: 1 };
    const parts: string[] = [];
    for (let p = Math.max(0, a.page); p <= Math.min(this.pageCount - 1, b.page); p++) {
      const pt = await this.pageText(p);
      const y0 = p === a.page ? (a.y ?? 0) * pt.h : -1;
      const y1 = p === b.page && b.y !== undefined ? b.y * pt.h : Infinity;
      const sel = pt.items.filter((it) => it.y + it.h / 2 >= y0 && it.y + it.h / 2 < y1);
      if (sel.length) parts.push(pt.text.slice(sel[0].start, sel[sel.length - 1].end));
    }
    return parts.join('\n');
  }

  async *textStream(from: Locator | undefined, options: TextStreamOptions = {}): AsyncGenerator<TextChunk> {
    const max = options.maxChunkChars ?? 400;
    const start = from?.kind === 'fixed' ? from : { page: 0, y: 0 };
    for (let page = Math.max(0, start.page); page < this.pageCount; page++) {
      if (options.signal?.aborted || this.destroyed) return;
      const pt = await this.pageText(page).catch(() => null);
      if (!pt || !pt.text.trim()) continue;
      for (const part of splitBlocks(pt.text, max, pt.breaks)) {
        const s = part.start;
        const e = part.start + part.text.length;
        const q0 = quadsFor(pt, s, s + 1)[0];
        const q1 = quadsFor(pt, Math.max(s, e - 1), e)[0];
        const y0 = q0 ? q0[1] / pt.h : 0;
        if (page === start.page && y0 < (start.y ?? 0) - 1e-6) continue;
        yield {
          text: part.text,
          locator: { kind: 'fixed', page, y: y0 },
          end: { kind: 'fixed', page, y: q1 ? q1[1] / pt.h : y0 },
          anchorFor: async (a, b): Promise<Anchor | null> => {
            const quads = quadsFor(pt, s + a, s + b);
            if (!quads.length) return null;
            return { locator: { kind: 'fixed', page, y: quads[0][1] / pt.h }, quote: makeQuote(pt.text, s + a, s + b), pdfQuads: quads };
          },
        };
      }
      if (page % 4 === 3) await tick();
    }
  }

  // ---- Thumbnails ------------------------------------------------------------------------------

  /** Cheap page thumbnail; renders are serialised so the sidebar never starves page rendering. */
  thumbnail(page: number, maxWidth: number): Promise<ImageBitmap | null> {
    const key = `${page}|${Math.round(maxWidth)}`;
    const run = async (): Promise<ImageBitmap | null> => {
      if (this.destroyed || page < 0 || page >= this.pageCount) return null;
      let bm = this.thumbs.get(key);
      if (!bm) {
        const pg = await this.proxy(page);
        const base = pg.getViewport({ scale: 1, rotation: pg.rotate });
        const vp = pg.getViewport({ scale: maxWidth / base.width, rotation: pg.rotate });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(vp.width));
        canvas.height = Math.max(1, Math.round(vp.height));
        await pg.render({ canvas, viewport: vp, annotationMode: 1 }).promise;
        pg.cleanup();
        bm = await createImageBitmap(canvas);
        this.thumbs.set(key, bm, bm.width * bm.height * 4);
      }
      return createImageBitmap(bm);
    };
    const result = this.thumbQueue.then(run, run).catch(() => null);
    this.thumbQueue = result;
    return result;
  }

  private async cover(): Promise<Blob | null> {
    const bm = await this.thumbnail(0, 480);
    if (!bm) return null;
    const c = document.createElement('canvas');
    c.width = bm.width;
    c.height = bm.height;
    c.getContext('2d')!.drawImage(bm, 0, 0);
    bm.close();
    return new Promise((res) => c.toBlob((b) => res(b), 'image/webp', 0.85));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.texts.clear();
    this.thumbs.clear();
    void this.pdf.loadingTask.destroy().catch(() => {});
  }
}
