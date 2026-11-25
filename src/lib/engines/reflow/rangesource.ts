/**
 * Lazy, Range-based access to a document URL. The Tauri file server caps a response at 16 MB,
 * and ebooks are zips that need random access, so nothing here ever reads a big file whole:
 * bytes come in aligned blocks (coalesced into <= 8 MB requests) and recent blocks are cached.
 * Servers that ignore `Range` (reply 200) fall back to one in-memory copy.
 */
import { EngineError } from '../types';

const BLOCK = 1 << 20; // 1 MiB
const MAX_REQUEST = 8 * BLOCK;
const CACHE_BLOCKS = 24;

export class RangeSource {
  private blocks = new Map<number, Uint8Array>();
  private whole: Uint8Array | null = null;

  private constructor(
    private readonly url: string,
    readonly size: number,
    private readonly signal?: AbortSignal,
  ) {}

  static async open(url: string, opts: { byteLength?: number; signal?: AbortSignal } = {}): Promise<RangeSource> {
    const { signal } = opts;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal });
    } catch (e) {
      if (signal?.aborted) throw new EngineError('aborted', undefined, { cause: e });
      throw new EngineError('network', `Could not read ${url}`, { cause: e });
    }
    if (res.status === 206) {
      const total = Number(/\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1]);
      await res.arrayBuffer();
      const size = Number.isFinite(total) && total > 0 ? total : opts.byteLength;
      if (size) return new RangeSource(url, size, signal);
      throw new EngineError('network', 'Server did not report the file size');
    }
    if (res.status === 200) {
      const whole = new Uint8Array(await res.arrayBuffer());
      const src = new RangeSource(url, whole.length, signal);
      src.whole = whole;
      return src;
    }
    throw new EngineError('network', `${res.status} ${res.statusText}`.trim());
  }

  /** Bytes [start, end), clamped to the file. */
  async read(start: number, end: number = this.size): Promise<Uint8Array> {
    start = Math.max(0, start);
    end = Math.min(this.size, end);
    if (end <= start) return new Uint8Array(0);
    if (this.whole) return this.whole.slice(start, end);

    const first = Math.floor(start / BLOCK);
    const last = Math.floor((end - 1) / BLOCK);
    const missing: number[] = [];
    for (let b = first; b <= last; b++) if (!this.blocks.has(b)) missing.push(b);
    // Coalesce runs of adjacent missing blocks into single requests.
    for (let i = 0; i < missing.length; ) {
      let j = i;
      while (j + 1 < missing.length && missing[j + 1] === missing[j]! + 1 && (j + 2 - i) * BLOCK <= MAX_REQUEST) j++;
      await this.fetchBlocks(missing[i]!, missing[j]!);
      i = j + 1;
    }
    if (first === last) {
      const blk = this.blocks.get(first)!;
      return blk.slice(start - first * BLOCK, end - first * BLOCK);
    }
    const out = new Uint8Array(end - start);
    for (let b = first; b <= last; b++) {
      const blk = this.blocks.get(b)!;
      const from = Math.max(start, b * BLOCK);
      const to = Math.min(end, b * BLOCK + blk.length);
      out.set(blk.subarray(from - b * BLOCK, to - b * BLOCK), from - start);
    }
    return out;
  }

  async blob(type = ''): Promise<Blob> {
    if (this.whole) return new Blob([this.whole as BlobPart], { type });
    const parts: BlobPart[] = [];
    for (let at = 0; at < this.size; at += MAX_REQUEST) parts.push((await this.read(at, at + MAX_REQUEST)) as BlobPart);
    return new Blob(parts, { type });
  }

  private async fetchBlocks(a: number, b: number): Promise<void> {
    const from = a * BLOCK;
    const to = Math.min(this.size, (b + 1) * BLOCK) - 1;
    let res: Response;
    try {
      res = await fetch(this.url, { headers: { Range: `bytes=${from}-${to}` }, signal: this.signal });
    } catch (e) {
      if (this.signal?.aborted) throw new EngineError('aborted', undefined, { cause: e });
      throw new EngineError('network', 'Read failed', { cause: e });
    }
    if (res.status === 200) {
      // Range ignored mid-way: keep the full body and serve from memory from now on.
      this.whole = new Uint8Array(await res.arrayBuffer());
      this.blocks.clear();
      return;
    }
    if (res.status !== 206) throw new EngineError('network', `${res.status} ${res.statusText}`.trim());
    const data = new Uint8Array(await res.arrayBuffer());
    for (let blk = a; blk <= b; blk++) {
      const part = data.subarray((blk - a) * BLOCK, (blk - a + 1) * BLOCK);
      this.blocks.set(blk, part.slice());
    }
    while (this.blocks.size > CACHE_BLOCKS) this.blocks.delete(this.blocks.keys().next().value as number);
  }
}

/** Minimal `File` look-alike for foliate's MOBI reader (`size`, `slice().arrayBuffer()`). */
export class RangeFile {
  readonly type = '';
  constructor(
    private readonly src: RangeSource,
    readonly name: string,
  ) {}
  get size(): number {
    return this.src.size;
  }
  slice(start = 0, end: number = this.src.size) {
    const src = this.src;
    return {
      arrayBuffer: async (): Promise<ArrayBuffer> => {
        const u8 = await src.read(start, end);
        return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
      },
    };
  }
}
