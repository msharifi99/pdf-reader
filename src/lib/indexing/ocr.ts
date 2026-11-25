/**
 * OCR for scans (Windows.Media.Ocr in the Rust core, offline).
 *
 *   const state = await ocr.prepare(bookId, engine, handle);   // on open: applies cached OCR instantly
 *   if (state.scanned && !state.complete) offer("Make this book searchable");
 *   const job = ocr.start(bookId, engine, { pageCount: handle.pageCount!, onProgress });     // user accepted
 *   job.pause(); job.resume(); job.cancel(); await job.done;
 *
 * Pages are rendered through the engine's `thumbnail()` at ~2000 px tall, sent to the core as raw
 * RGBA (binary body, no JSON), and the returned word boxes are fed back with `engine.setOcrWords`
 * so search, selection (PDF), highlights, read-aloud and the library index see the text. Results
 * are cached by the core (`ocr_pages`): OCR runs once per book. It yields between pages, so
 * reading is never blocked; cancel/pause take effect at the next page boundary.
 */
import type { OcrPage, OcrLanguage } from '../core/bindings';
import { core, raw } from '../core/core';
import type { BookHandle, Engine, OcrWord } from '../engines/types';

/** Page height OCR is run at: tall enough for small print, small enough to stay quick. */
export const OCR_PAGE_HEIGHT = 2000;
const MAX_WIDTH = 4000;

export interface OcrState {
  /** The book has no text layer and its engine supports OCR (PDF scans; also image books, where the UI should make the offer opt-in). */
  scanned: boolean;
  pagesDone: number;
  pageCount: number;
  /** Every page has cached OCR: nothing left to offer. */
  complete: boolean;
}

export interface OcrProgress {
  /** Pages finished in this run (including failed ones). */
  done: number;
  /** Pages this run will process (already-cached pages are not counted). */
  total: number;
  /** The page just finished (0-based). */
  page: number;
  words: number;
}

export interface OcrResult {
  /** Pages OCR'd in this run. */
  pages: number;
  /** Pages that failed and were skipped. */
  failed: number;
  cancelled: boolean;
}

export interface OcrJob {
  /** Resolves when finished or cancelled; rejects if OCR can't run at all (e.g. no Windows OCR language). */
  readonly done: Promise<OcrResult>;
  pause(): void;
  resume(): void;
  cancel(): void;
  readonly paused: boolean;
}

export interface OcrOptions {
  /** `BookHandle.pageCount` of the open book. */
  pageCount: number;
  onProgress?: (p: OcrProgress) => void;
  /** BCP-47 tag from `ocrLanguages()`; default: the user's Windows profile languages. */
  lang?: string;
  /** Pause between pages so the UI thread and the reader's own rendering keep priority. */
  idleMs?: number;
}

type PageSpace = { width: number; height: number; rotate: 0 | 90 | 180 | 270 };

/** No text on the sampled pages (the engines sample up to five pages when opening) and OCR is supported. */
export function detectScanned(engine: Engine, handle: BookHandle): boolean {
  return !handle.hasText && handle.capabilities.ocr && typeof engine.setOcrWords === 'function' && typeof engine.ocrPageSize === 'function' && (handle.pageCount ?? 0) > 0;
}

/**
 * Word boxes measured on the displayed bitmap (0..1) -> the engine's page space, undoing the page's
 * display rotation (see `Engine.ocrPageSize`).
 */
export function toPageSpace(words: OcrPage['words'], s: PageSpace): OcrWord[] {
  const { width: W, height: H } = s;
  return words.map(({ text, x, y, width: w, height: h }) => {
    switch (s.rotate) {
      case 90:
        return { text, x: y * W, y: (1 - x - w) * H, width: h * W, height: w * H };
      case 180:
        return { text, x: (1 - x - w) * W, y: (1 - y - h) * H, width: w * W, height: h * H };
      case 270:
        return { text, x: (1 - y - h) * W, y: x * H, width: h * W, height: w * H };
      default:
        return { text, x: x * W, y: y * H, width: w * W, height: h * H };
    }
  });
}

async function applyPages(engine: Engine, pages: OcrPage[]): Promise<void> {
  for (let i = 0; i < pages.length; i += 16) {
    await Promise.all(
      pages.slice(i, i + 16).map(async (p) => {
        const space = await engine.ocrPageSize?.(p.page);
        if (space && p.words.length) engine.setOcrWords?.(p.page, toPageSpace(p.words, space));
      }),
    );
  }
}

/** Load cached OCR from the core and apply it to `engine`. Call right after `open()` so a scan is searchable at once. */
export async function prepare(bookId: string, engine: Engine, handle: BookHandle): Promise<OcrState> {
  const scanned = detectScanned(engine, handle);
  const cached = await core.getOcrPages(bookId);
  await applyPages(engine, cached);
  const pageCount = handle.pageCount ?? 0;
  return { scanned: scanned || cached.length > 0, pagesDone: cached.length, pageCount, complete: pageCount > 0 && cached.length >= pageCount };
}

/** Render `page` at `OCR_PAGE_HEIGHT` as raw RGBA on white (PDF pages are transparent). */
async function pagePixels(engine: Engine, page: number, space: PageSpace): Promise<{ rgba: Uint8Array; width: number; height: number } | null> {
  const turned = space.rotate === 90 || space.rotate === 270;
  const dispW = turned ? space.height : space.width;
  const dispH = turned ? space.width : space.height;
  const thumb = await engine.thumbnail?.(page, Math.min(MAX_WIDTH, Math.round((dispW * OCR_PAGE_HEIGHT) / dispH)));
  if (!thumb) return null;
  const bm = thumb instanceof Blob ? await createImageBitmap(thumb) : thumb;
  const canvas = new OffscreenCanvas(bm.width, bm.height);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, bm.width, bm.height);
  g.drawImage(bm, 0, 0);
  const { width, height } = bm;
  bm.close();
  const px = g.getImageData(0, 0, width, height).data;
  return { rgba: new Uint8Array(px.buffer, px.byteOffset, px.byteLength), width, height };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Start OCR for the pages that have no cached result yet. Safe to call again after a cancel: it resumes. */
export function start(bookId: string, engine: Engine, opts: OcrOptions): OcrJob {
  let cancelled = false;
  let paused = false;
  let wake: (() => void) | null = null;
  const gate = async () => {
    while (paused && !cancelled) await new Promise<void>((r) => (wake = r));
  };
  const done = (async (): Promise<OcrResult> => {
    const cached = new Set((await core.getOcrPages(bookId)).map((p) => p.page));
    const todo = Array.from({ length: opts.pageCount }, (_, i) => i).filter((i) => !cached.has(i));
    const result: OcrResult = { pages: 0, failed: 0, cancelled: false };
    let consecutive = 0;
    for (const page of todo) {
      await gate();
      if (cancelled) break;
      try {
        const space = await engine.ocrPageSize?.(page);
        const px = space && (await pagePixels(engine, page, space));
        if (!space || !px) throw new Error(`Page ${page + 1} couldn't be rendered.`);
        const r = await raw.ocrPage({ bookId, page, width: px.width, height: px.height, lang: opts.lang }, px.rgba);
        engine.setOcrWords?.(page, toPageSpace(r.words, space));
        result.pages++;
        consecutive = 0;
        opts.onProgress?.({ done: result.pages + result.failed, total: todo.length, page, words: r.words.length });
      } catch (e) {
        const code = (e as { code?: string })?.code;
        // No OCR language / unsupported platform: every page would fail the same way.
        if (code === 'Unsupported' || (code === 'Invalid' && result.pages === 0) || ++consecutive >= 3) throw e;
        result.failed++;
        opts.onProgress?.({ done: result.pages + result.failed, total: todo.length, page, words: 0 });
      }
      await sleep(opts.idleMs ?? 30);
    }
    result.cancelled = cancelled;
    if (!cancelled && result.pages > 0) await indexOcr(bookId);
    return result;
  })();
  return {
    done,
    pause: () => void (paused = true),
    resume: () => {
      paused = false;
      wake?.();
    },
    cancel: () => {
      cancelled = true;
      wake?.();
    },
    get paused() {
      return paused;
    },
  };
}

/** Put a book's OCR text into the library search index right away (one chunk per page). */
export async function indexOcr(bookId: string): Promise<void> {
  const pages = await core.getOcrPages(bookId);
  const chunks = pages
    .map((p) => ({ locator: { kind: 'fixed', page: p.page, y: 0 }, text: p.words.map((w) => w.text).join(' ') }))
    .filter((c) => c.text.trim());
  await core.indexBookChunks(bookId, chunks, true, true);
}

/** OCR languages installed in Windows (empty if none); the default one is flagged. */
export const languages = (): Promise<OcrLanguage[]> => core.ocrLanguages();

/** Forget a book's OCR (to redo it in another language). */
export const clear = (bookId: string): Promise<null> => core.clearOcr(bookId);

export const ocr = { detectScanned, prepare, start, languages, clear, indexOcr, toPageSpace };
