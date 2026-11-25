/**
 * The background indexer's logic (runs in the hidden `indexer` window; the same code runs in-page
 * under Playwright against the fake core). One book at a time: open it with its Engine (never
 * rendered), stream `textStream` chunks into the core's FTS5 index in ~1-2 KB pieces with a
 * Locator each, dispose, move on. It waits while the user is reading, throttles itself, records
 * a failure per book (never retried in a loop) and keeps memory bounded by disposing every engine.
 */
import type { Book, Chunk } from '../core/bindings';
import { core, coreEvents } from '../core/core';
import type { Engine, Locator } from '../engines/types';
import { prepare } from './ocr';
import { openBookHeadless } from './open';

/** Target size of one indexed chunk, in characters (the engines yield sentences of ~400). */
export const CHUNK_CHARS = 1600;
const BATCH_CHUNKS = 40;
/** A book that yields nothing for this long is abandoned and marked failed. */
const STALL_MS = 120_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mirrors the core's reading flag: `wait()` resolves immediately unless the user is reading. */
export class PauseGate {
  paused = false;
  private waiters: (() => void)[] = [];
  private off: (() => void) | null = null;

  async start(): Promise<void> {
    this.paused = (await core.indexStatus()).paused;
    this.off = await coreEvents.onIndexControl((c) => this.set(c.paused));
  }
  set(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.waiters.splice(0).forEach((w) => w());
  }
  wait(signal?: AbortSignal): Promise<void> {
    if (!this.paused || signal?.aborted) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }
  stop(): void {
    this.off?.();
    this.set(false);
  }
}

export interface IndexBookOptions {
  gate?: PauseGate;
  /** Pause after each batch sent to the core (keeps CPU and IPC calm). */
  throttleMs?: number;
  signal?: AbortSignal;
}

/** Index one book. Resolves with the number of chunks stored; rejects (and stores nothing) on failure. */
export async function indexBook(book: Book, opts: IndexBookOptions = {}): Promise<number> {
  const ac = new AbortController();
  opts.signal?.addEventListener('abort', () => ac.abort(), { once: true });
  let stall: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(stall);
    stall = setTimeout(() => ac.abort(), STALL_MS);
  };
  touch();
  let engine: Engine | undefined;
  try {
    const opened = await openBookHeadless(book, ac.signal);
    engine = opened.engine;
    // Scans: their text exists only as cached OCR results.
    if (opened.handle.capabilities.ocr) await prepare(book.id, engine, opened.handle);

    let first = true;
    let stored = 0;
    let batch: Chunk[] = [];
    let cur: { locator: Locator; text: string } | null = null;
    const flush = async (done: boolean) => {
      await core.indexBookChunks(book.id, batch, first, done);
      stored += batch.length;
      first = false;
      batch = [];
      if (!done) await sleep(opts.throttleMs ?? 25);
    };
    const seal = () => {
      if (cur?.text.trim()) batch.push({ locator: cur.locator, text: cur.text });
      cur = null;
    };
    for await (const c of engine.textStream(undefined, { maxChunkChars: 600, signal: ac.signal })) {
      if (opts.gate?.paused) {
        clearTimeout(stall);
        await opts.gate.wait(ac.signal);
      }
      touch();
      if (ac.signal.aborted) throw new Error('Indexing this book took too long.');
      const samePage = !cur || cur.locator.kind !== 'fixed' || (c.locator.kind === 'fixed' && c.locator.page === cur.locator.page);
      if (cur && (!samePage || cur.text.length + c.text.length > CHUNK_CHARS)) seal();
      if (cur) cur.text += ` ${c.text}`;
      else cur = { locator: c.locator, text: c.text };
      if (batch.length >= BATCH_CHUNKS) await flush(false);
    }
    if (ac.signal.aborted) throw new Error('Indexing this book took too long.');
    seal();
    await flush(true);
    return stored;
  } finally {
    clearTimeout(stall);
    engine?.dispose();
  }
}

export interface RunOptions extends IndexBookOptions {
  /** Books fetched per round. */
  batch?: number;
  /** Stop (resolving `'restart'`) after this many books so the host window can reload and shed memory. */
  restartAfter?: number;
  /** Pause between books. */
  betweenMs?: number;
  onBook?: (book: Book, outcome: { chunks: number } | { error: string }) => void;
}

/**
 * Index everything that needs it, once. Resolves `'idle'` when nothing is left, `'restart'` after
 * `restartAfter` books, `'aborted'` if `signal` fired.
 */
export async function runIndexer(opts: RunOptions = {}): Promise<'idle' | 'restart' | 'aborted'> {
  const tried = new Set<string>(); // a book is attempted once per window lifetime: no hot loops
  let count = 0;
  for (;;) {
    const books = (await core.booksNeedingIndex(opts.batch ?? 20)).filter((b) => !tried.has(b.id));
    if (!books.length) return 'idle';
    for (const book of books) {
      if (opts.signal?.aborted) return 'aborted';
      await opts.gate?.wait(opts.signal);
      tried.add(book.id);
      try {
        const chunks = await indexBook(book, opts);
        opts.onBook?.(book, { chunks });
      } catch (e) {
        const error = (e as Error)?.message || (e as { code?: string })?.code || 'Unknown error';
        await core.markIndexFailed(book.id, error).catch(() => {});
        opts.onBook?.(book, { error });
      }
      if (opts.restartAfter && ++count >= opts.restartAfter) return 'restart';
      await sleep(opts.betweenMs ?? 400);
    }
  }
}
