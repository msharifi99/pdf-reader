/**
 * Format sniffing by magic bytes (never by extension). Reads only the first 16 KB and,
 * for ZIP containers, the last 64 KB (central directory) via Range requests.
 */
import type { BookFormat, EngineKind } from './types';

export type ImageType = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'bmp' | 'tiff' | 'svg';

export interface SniffResult {
  /** `null` when the bytes are not a supported document. */
  format: BookFormat | null;
  /** For `format === 'image'`. */
  imageType?: ImageType;
  mime: string;
}

export const HEAD_BYTES = 16 * 1024;
export const TAIL_BYTES = 64 * 1024;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?)$/i;

export function engineKindFor(format: BookFormat): EngineKind {
  switch (format) {
    case 'pdf':
      return 'pdf';
    case 'cbz':
    case 'cbr':
    case 'image':
      return 'comic';
    default:
      return 'reflow';
  }
}

const startsWith = (b: Uint8Array, sig: number[] | string, at = 0): boolean => {
  const s = typeof sig === 'string' ? Array.from(sig, (c) => c.charCodeAt(0)) : sig;
  if (b.length < at + s.length) return false;
  return s.every((v, i) => b[at + i] === v);
};

const latin1 = (b: Uint8Array, start = 0, end = b.length): string => {
  let out = '';
  for (let i = start; i < Math.min(end, b.length); i++) out += String.fromCharCode(b[i]!);
  return out;
};

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const be16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const be32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

function sniffImage(head: Uint8Array): ImageType | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(head, 'GIF87a') || startsWith(head, 'GIF89a')) return 'gif';
  if (startsWith(head, 'RIFF') && startsWith(head, 'WEBP', 8)) return 'webp';
  if (startsWith(head, 'ftyp', 4)) {
    const brand = latin1(head, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (startsWith(head, 'BM') && head.length >= 18 && [12, 40, 52, 56, 64, 108, 124].includes(u32(head, 14))) return 'bmp';
  const text = latin1(head, 0, 1024).replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart();
  if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(text)) return 'svg';
  return null;
}

const IMAGE_MIME: Record<ImageType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
};

/** PalmDB: 'BOOKMOBI' at 60. MOBI header version 8 => KF8 (AZW3). */
function sniffMobi(head: Uint8Array): 'mobi' | 'azw3' | null {
  if (!startsWith(head, 'BOOKMOBI', 60)) return null;
  // record 0 offset: first entry of the record list that starts at byte 78.
  if (head.length >= 82) {
    const rec0 = be32(head, 78);
    // PalmDOC header is 16 bytes, then 'MOBI', header length, type, encoding, uid, version(+20).
    if (rec0 + 40 <= head.length && startsWith(head, 'MOBI', rec0 + 16)) {
      if (be32(head, rec0 + 36) === 8) return 'azw3';
    }
  }
  return 'mobi';
}

/** Zip entry names from the central directory found in `tail` (the end of the file). */
export function zipEntryNames(tail: Uint8Array): string[] {
  // Locate the central directory: via EOCD if possible, else the first central header in the buffer.
  let pos = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) {
      const cdSize = u32(tail, i + 12);
      const start = i - cdSize;
      if (start >= 0 && startsWith(tail, [0x50, 0x4b, 1, 2], start)) pos = start;
      break;
    }
  }
  if (pos < 0) {
    for (let i = 0; i + 4 <= tail.length; i++) {
      if (startsWith(tail, [0x50, 0x4b, 1, 2], i)) {
        pos = i;
        break;
      }
    }
  }
  const names: string[] = [];
  const dec = new TextDecoder('utf-8');
  while (pos >= 0 && pos + 46 <= tail.length && startsWith(tail, [0x50, 0x4b, 1, 2], pos)) {
    const n = u16(tail, pos + 28);
    const extra = u16(tail, pos + 30);
    const comment = u16(tail, pos + 32);
    if (pos + 46 + n > tail.length) break;
    names.push(dec.decode(tail.subarray(pos + 46, pos + 46 + n)));
    pos += 46 + n + extra + comment;
  }
  return names;
}

function sniffZip(head: Uint8Array, tail: Uint8Array | undefined): { format: BookFormat | null; mime: string } {
  // EPUB: first local entry is a stored 'mimetype' file holding application/epub+zip.
  if (startsWith(head, 'mimetype', 30) && latin1(head, 38, 38 + 20).startsWith('application/epub+zip')) {
    return { format: 'epub', mime: 'application/epub+zip' };
  }
  if (!tail) return { format: null, mime: 'application/zip' };
  const names = zipEntryNames(tail);
  if (names.includes('META-INF/container.xml')) return { format: 'epub', mime: 'application/epub+zip' };
  const files = names.filter((n) => !n.endsWith('/'));
  if (files.some((n) => /\.fb2$/i.test(n)) && files.length <= 3) return { format: 'fbz', mime: 'application/x-zip-compressed-fb2' };
  const imgs = files.filter((n) => IMAGE_EXT.test(n));
  if (imgs.length > 0 && imgs.length >= files.length / 2) return { format: 'cbz', mime: 'application/vnd.comicbook+zip' };
  return { format: null, mime: 'application/zip' };
}

/**
 * Pure sniffing. `head`: first bytes of the file. `tail`: last bytes (only needed to classify
 * ZIPs that are not a standard EPUB); pass `head` itself for tiny files.
 */
export function sniffBytes(head: Uint8Array, tail?: Uint8Array): SniffResult {
  // PDF: header may be preceded by junk, but must appear in the first 1 KB.
  if (latin1(head, 0, 1024).includes('%PDF-')) return { format: 'pdf', mime: 'application/pdf' };

  if (startsWith(head, 'Rar!\x1a\x07\x00') || startsWith(head, 'Rar!\x1a\x07\x01\x00')) {
    return { format: 'cbr', mime: 'application/vnd.rar' };
  }

  if (startsWith(head, 'PK\x03\x04') || startsWith(head, 'PK\x05\x06')) {
    const z = sniffZip(head, tail);
    return z;
  }

  const mobi = sniffMobi(head);
  if (mobi) return { format: mobi, mime: mobi === 'azw3' ? 'application/vnd.amazon.ebook' : 'application/x-mobipocket-ebook' };

  const img = sniffImage(head);
  if (img) return { format: 'image', imageType: img, mime: IMAGE_MIME[img] };

  // FB2: XML with a <FictionBook root near the top (BOM / xml declaration / comments allowed before).
  if (/<FictionBook[\s>]/.test(latin1(head, 0, 4096))) return { format: 'fb2', mime: 'application/x-fictionbook+xml' };

  return { format: null, mime: 'application/octet-stream' };
}

/** Random-access reader; implemented over Range fetches or Blobs. */
export interface RangeReader {
  size: number;
  /** Bytes in `[start, end)`. */
  read(start: number, end: number): Promise<Uint8Array>;
}

export function blobReader(blob: Blob): RangeReader {
  return {
    size: blob.size,
    read: async (s, e) => new Uint8Array(await blob.slice(s, e).arrayBuffer()),
  };
}

/** Range-fetch reader. One initial `bytes=0-<HEAD>` request discovers the size from Content-Range. */
export async function urlReader(url: string, signal?: AbortSignal): Promise<RangeReader> {
  const first = await fetch(url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` }, signal });
  if (!first.ok) throw new Error(`sniff: HTTP ${first.status} for ${url}`);
  const head = new Uint8Array(await first.arrayBuffer());
  const total = /\/(\d+)$/.exec(first.headers.get('Content-Range') ?? '')?.[1];
  const size = total ? Number(total) : head.length; // no Content-Range => server sent everything
  return {
    size,
    read: async (s, e) => {
      if (s === 0 && e <= head.length) return head.subarray(0, e);
      const r = await fetch(url, { headers: { Range: `bytes=${s}-${e - 1}` }, signal });
      if (!r.ok) throw new Error(`sniff: HTTP ${r.status} for ${url}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

export async function sniff(reader: RangeReader): Promise<SniffResult> {
  const head = await reader.read(0, Math.min(HEAD_BYTES, reader.size));
  const isZip = startsWith(head, 'PK');
  const needsTail = isZip && reader.size > head.length;
  const tail = needsTail ? await reader.read(Math.max(0, reader.size - TAIL_BYTES), reader.size) : head;
  return sniffBytes(head, tail);
}

/** Convenience: sniff a URL or Blob. */
export async function sniffSource(src: string | Blob, signal?: AbortSignal): Promise<SniffResult> {
  return sniff(typeof src === 'string' ? await urlReader(src, signal) : blobReader(src));
}
