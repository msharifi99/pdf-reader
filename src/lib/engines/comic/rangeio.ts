/**
 * Range-based file access. The Tauri file server caps a response at 16 MB, and a CBZ/CBR can be
 * hundreds of MB, so nothing here reads a big file whole in one request: bytes arrive in 1 MiB
 * blocks (coalesced to <= 8 MiB requests) and a handful of recent blocks stay cached.
 * Servers that ignore `Range` (reply 200) fall back to a single in-memory copy.
 */
import { Reader } from '@zip.js/zip.js';
import { EngineError } from '../types';

const BLOCK = 1 << 20;
const MAX_REQUEST = 8 * BLOCK;
const CACHE_BLOCKS = 24;
/** Chunk size for assembling a whole file (CBR): under the 16 MB protocol cap. */
export const CHUNK = 12 * (1 << 20);

async function get(url: string, range: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { headers: { Range: range }, signal });
  } catch (e) {
    if (signal?.aborted) throw new EngineError('aborted', undefined, { cause: e });
    throw new EngineError('network', 'Could not read the file', { cause: e });
  }
}

export class RangeFile {
  private blocks = new Map<number, Uint8Array>();
  private whole: Uint8Array | null = null;

  private constructor(
    readonly url: string,
    readonly size: number,
    private readonly signal?: AbortSignal,
  ) {}

  static async open(url: string, opts: { byteLength?: number; signal?: AbortSignal } = {}): Promise<RangeFile> {
    const res = await get(url, 'bytes=0-0', opts.signal);
    if (res.status === 206) {
      const total = Number(/\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1]);
      await res.arrayBuffer();
      const size = Number.isFinite(total) && total > 0 ? total : opts.byteLength;
      if (!size) throw new EngineError('network', 'The server did not report the file size');
      return new RangeFile(url, size, opts.signal);
    }
    if (res.status === 200) {
      const whole = new Uint8Array(await res.arrayBuffer());
      const f = new RangeFile(url, whole.length, opts.signal);
      f.whole = whole;
      return f;
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
    for (let i = 0; i < missing.length; ) {
      let j = i;
      while (j + 1 < missing.length && missing[j + 1] === missing[j]! + 1 && (j + 2 - i) * BLOCK <= MAX_REQUEST) j++;
      await this.fetchBlocks(missing[i]!, missing[j]!);
      i = j + 1;
    }
    const whole = this.whole as Uint8Array | null; // a fetch above may have swapped to a full copy
    if (whole) return whole.slice(start, end);
    const out = new Uint8Array(end - start);
    for (let b = first; b <= last; b++) {
      const blk = this.blocks.get(b)!;
      const from = Math.max(start, b * BLOCK);
      const to = Math.min(end, b * BLOCK + blk.length);
      out.set(blk.subarray(from - b * BLOCK, to - b * BLOCK), from - start);
    }
    return out;
  }

  /** The whole file as a Blob, fetched in <16 MB chunks (libarchive needs a File, not a random-access reader). */
  async blob(): Promise<Blob> {
    if (this.whole) return new Blob([this.whole as BlobPart]);
    const parts: BlobPart[] = [];
    for (let at = 0; at < this.size; at += CHUNK) {
      const res = await get(this.url, `bytes=${at}-${Math.min(this.size, at + CHUNK) - 1}`, this.signal);
      if (res.status === 200) return await res.blob(); // Range ignored: this is already the whole body
      if (res.status !== 206) throw new EngineError('network', `${res.status} ${res.statusText}`.trim());
      parts.push(await res.blob());
    }
    return new Blob(parts);
  }

  private async fetchBlocks(a: number, b: number): Promise<void> {
    const to = Math.min(this.size, (b + 1) * BLOCK) - 1;
    const res = await get(this.url, `bytes=${a * BLOCK}-${to}`, this.signal);
    if (res.status === 200) {
      this.whole = new Uint8Array(await res.arrayBuffer());
      this.blocks.clear();
      return;
    }
    if (res.status !== 206) throw new EngineError('network', `${res.status} ${res.statusText}`.trim());
    const data = new Uint8Array(await res.arrayBuffer());
    for (let blk = a; blk <= b; blk++) this.blocks.set(blk, data.slice((blk - a) * BLOCK, (blk - a + 1) * BLOCK));
    while (this.blocks.size > CACHE_BLOCKS) this.blocks.delete(this.blocks.keys().next().value as number);
  }
}

/** zip.js reader over a `RangeFile`: only the central directory and the entries actually read are fetched. */
export class ZipRangeReader extends Reader<RangeFile> {
  private readonly file: RangeFile;
  constructor(file: RangeFile) {
    super(file);
    this.file = file;
    this.size = file.size;
  }
  async readUint8Array(offset: number, length: number): Promise<Uint8Array> {
    return this.file.read(offset, offset + length);
  }
}
