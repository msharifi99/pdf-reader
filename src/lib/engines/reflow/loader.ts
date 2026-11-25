/**
 * Turns a BookSource into a foliate-js "book" object (EPUB, MOBI/AZW3, FB2, FBZ) and classifies
 * failures: DRM and corruption become typed EngineErrors, never raw exceptions.
 */
import { BlobWriter, Reader, TextWriter, ZipReader, configure, type Entry, type FileEntry } from '@zip.js/zip.js';
import { EngineError, type BookSource } from '../types';
import { RangeFile, RangeSource } from './rangesource';

export interface LoadedBook {
  // foliate-js has no types; the engine narrows what it uses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  book: any;
  family: 'epub' | 'mobi' | 'fb2';
  destroy(): void;
}

configure({ useWebWorkers: false });

/** Algorithms in META-INF/encryption.xml that are mere font obfuscation, not DRM. */
const FONT_OBFUSCATION = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
]);

/** Pure: does an EPUB `encryption.xml` protect content (as opposed to obfuscating fonts)? */
export function encryptionIsDrm(xml: string): boolean {
  const algos = [...xml.matchAll(/Algorithm\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]!);
  // EncryptionMethod elements carry the content algorithm; <ds:Transform>/<CanonicalizationMethod> also use Algorithm.
  const methods = [...xml.matchAll(/<(?:\w+:)?EncryptionMethod\b[^>]*Algorithm\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]!);
  const list = methods.length ? methods : algos;
  return list.some((a) => !FONT_OBFUSCATION.has(a));
}

/** Pure: PalmDOC record 0 header -> is the MOBI text encrypted? (bytes 12..13, big endian) */
export function mobiHeaderIsDrm(record0: Uint8Array): boolean {
  return record0.length >= 14 && ((record0[12]! << 8) | record0[13]!) !== 0;
}

/** Pure: PDB record table (header bytes) -> offsets are ascending and inside the file? Catches truncation. */
export function pdbRecordsValid(head: Uint8Array, fileSize: number): boolean {
  if (head.length < 78) return false;
  const n = (head[76]! << 8) | head[77]!;
  if (n < 2 || head.length < 78 + n * 8) return false;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const o = 78 + i * 8;
    const off = ((head[o]! << 24) | (head[o + 1]! << 16) | (head[o + 2]! << 8) | head[o + 3]!) >>> 0;
    if (off < prev || off >= fileSize) return false;
    prev = off;
  }
  return true;
}

/** Pure: does an FB2 (head/tail text) look like a complete FictionBook document? Catches truncation and non-FB2 XML. */
export function fb2LooksComplete(head: string, tail: string): boolean {
  return /<FictionBook\b/i.test(head) && /<\/FictionBook>\s*$/i.test(tail);
}

class RangeZipReader extends Reader<RangeSource> {
  constructor(private readonly src: RangeSource) {
    super(src);
    this.size = src.size;
  }
  readUint8Array(index: number, length: number): Promise<Uint8Array> {
    return this.src.read(index, index + length);
  }
}

const corrupt = (what: string, cause: unknown) => new EngineError('corrupt', `${what}: ${(cause as Error)?.message ?? cause}`, { cause });

function asEngineError(e: unknown, what: string): EngineError {
  return e instanceof EngineError ? e : corrupt(what, e);
}

async function openZip(src: RangeSource) {
  let reader: ZipReader<RangeSource>;
  let entries: Entry[];
  try {
    reader = new ZipReader(new RangeZipReader(src));
    entries = await reader.getEntries();
  } catch (e) {
    throw corrupt('Not a readable ZIP container', e);
  }
  const map = new Map(entries.map((e) => [e.filename, e]));
  const get = async <T>(name: string, w: () => unknown): Promise<T | null> => {
    const entry = map.get(name) as FileEntry | undefined;
    return entry?.getData ? ((await entry.getData(w() as never)) as T) : null;
  };
  return {
    entries,
    has: (n: string) => map.has(n),
    loadText: (n: string) => get<string>(n, () => new TextWriter()),
    loadBlob: (n: string, type?: string) => get<Blob>(n, () => new BlobWriter(type)),
    getSize: (n: string) => map.get(n)?.uncompressedSize ?? 0,
    close: () => void reader.close().catch(() => {}),
  };
}

const sha1 = async (str: string) => new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str)));

async function loadEpub(src: RangeSource) {
  const zip = await openZip(src);
  if (zip.has('META-INF/rights.xml') || zip.has('META-INF/sinf.xml')) throw new EngineError('drm', 'This book is DRM-protected.');
  const enc = await zip.loadText('META-INF/encryption.xml').catch(() => null);
  if (enc && encryptionIsDrm(enc)) throw new EngineError('drm', 'This book is DRM-protected.');
  try {
    const { EPUB } = await import('foliate-js/epub.js');
    const book = await new EPUB({ ...zip, sha1 }).init();
    if (!book.sections?.length) throw new Error('The book has no readable sections');
    return { book, destroy: () => (book.destroy?.(), zip.close()) };
  } catch (e) {
    zip.close();
    throw asEngineError(e, 'Invalid EPUB');
  }
}

async function loadFb2Blob(blob: Blob) {
  const text = (b: Blob) => b.text();
  if (!fb2LooksComplete(await text(blob.slice(0, 4096)), await text(blob.slice(Math.max(0, blob.size - 256)))))
    throw corrupt('Not a complete FictionBook file', null);
  try {
    const { makeFB2 } = await import('foliate-js/fb2.js');
    const book = await makeFB2(blob);
    if (!book.sections?.length) throw new Error('The book has no readable sections');
    return { book, destroy: () => book.destroy?.() };
  } catch (e) {
    throw asEngineError(e, 'Invalid FictionBook');
  }
}

async function loadFbz(src: RangeSource) {
  const zip = await openZip(src);
  const entry = zip.entries.find((e) => e.filename.toLowerCase().endsWith('.fb2')) ?? zip.entries.find((e) => !e.directory);
  const blob = entry ? await zip.loadBlob(entry.filename) : null;
  zip.close();
  if (!blob) throw corrupt('Empty FBZ archive', null);
  return loadFb2Blob(blob);
}

async function loadMobi(src: RangeSource, name: string) {
  if (src.size < 100) throw corrupt('File too small for MOBI', null);
  const file = new RangeFile(src, name);
  const { isMOBI, MOBI } = await import('foliate-js/mobi.js');
  if (!(await isMOBI(file))) throw new EngineError('unsupported-format', 'Not a MOBI/AZW3 file.');
  // PDB header -> record 0 -> PalmDOC encryption flag.
  const head = await src.read(0, Math.min(src.size, 78 + 8 * 4096));
  if (!pdbRecordsValid(head, src.size)) throw corrupt('MOBI record table is damaged or the file is truncated', null);
  const off0 = ((head[78]! << 24) | (head[79]! << 16) | (head[80]! << 8) | head[81]!) >>> 0;
  if (off0 + 16 > src.size) throw corrupt('Bad MOBI record table', null);
  if (mobiHeaderIsDrm(await src.read(off0, off0 + 16))) throw new EngineError('drm', 'This book is DRM-protected.');
  try {
    const { unzlibSync } = await import('foliate-js/vendor/fflate.js');
    const book = await new MOBI({ unzlib: unzlibSync }).open(file);
    if (!book.sections?.length) throw new Error('The book has no readable sections');
    return { book, destroy: () => book.destroy?.() };
  } catch (e) {
    throw asEngineError(e, 'Invalid MOBI');
  }
}

export async function loadBook(source: BookSource, signal?: AbortSignal): Promise<LoadedBook> {
  if (source.kind !== 'file') throw new EngineError('unsupported-format', 'The reflow engine opens ebook files only.');
  const src = await RangeSource.open(source.url, { byteLength: source.byteLength, signal });
  if (signal?.aborted) throw new EngineError('aborted');
  const name = source.fileName ?? 'book';
  try {
    switch (source.format) {
      case 'epub':
        return { family: 'epub', ...(await loadEpub(src)) };
      case 'mobi':
      case 'azw3':
        return { family: 'mobi', ...(await loadMobi(src, name)) };
      case 'fb2':
        return { family: 'fb2', ...(await loadFb2Blob(await src.blob('application/x-fictionbook+xml'))) };
      case 'fbz':
        return { family: 'fb2', ...(await loadFbz(src)) };
      default:
        throw new EngineError('unsupported-format', `Cannot open ${source.format} here.`);
    }
  } catch (e) {
    throw e instanceof EngineError ? e : corrupt('Could not open book', e);
  }
}
