/**
 * Where a comic's pages come from. A `PageSource` lists page names in reading order and hands out
 * each page as a Blob on demand; the engine never needs more than a few pages in memory.
 *  - CBZ: zip.js over Range requests (only the central directory + the pages actually read).
 *  - CBR / CB7 / anything else libarchive reads: the whole file is assembled in <16 MB Range chunks
 *    and handed to libarchive.js once (it copies it into its WASM heap and we drop our reference),
 *    after which single pages are extracted on demand.
 *  - Folders / single images: one fetch per page.
 */
import { BlobWriter, TextWriter, ZipReader, configure, type Entry, type FileEntry } from '@zip.js/zip.js';
import { EngineError, type BookSource, type OpenOptions } from '../types';
import { RangeFile, ZipRangeReader } from './rangeio';
import { baseName, isPageName, mimeFor, naturalCompare } from './pages';

export interface PageSource {
  /** Page names in reading order. */
  names: string[];
  /** Raw ComicInfo.xml text when the archive has one. */
  comicInfo?: string;
  load(index: number): Promise<Blob>;
  close(): void;
}

const typed = (blob: Blob, name: string): Blob => {
  const mime = mimeFor(name);
  return blob.type === mime || mime === 'application/octet-stream' ? blob : new Blob([blob], { type: mime });
};

const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new EngineError('aborted');
};

/** Magic bytes of the formats a page can be (SVG starts with markup). */
function looksLikeImage(b: Uint8Array): boolean {
  const at = (sig: number[], o = 0) => sig.every((v, i) => b[o + i] === v);
  return at([0x89, 0x50, 0x4e, 0x47]) || at([0xff, 0xd8, 0xff]) || at([0x47, 0x49, 0x46, 0x38]) || (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) || at([0x66, 0x74, 0x79, 0x70], 4) || at([0x42, 0x4d]) || b[0] === 0x3c || (b[0] === 0xef && b[1] === 0xbb);
}

const isComicInfo = (path: string) => baseName(path).toLowerCase() === 'comicinfo.xml';

/** Pick the right reader from the bytes (a ".cbr" that is really a zip is common). */
export async function openSource(source: BookSource, options: OpenOptions = {}): Promise<PageSource> {
  const { signal } = options;
  if (source.kind === 'images') return imagesSource(source.urls, source.names);
  if (source.format === 'image') return imagesSource([source.url], [source.fileName ?? baseName(source.url)]);

  const file = await RangeFile.open(source.url, { byteLength: source.byteLength, signal });
  const head = await file.read(0, 8);
  aborted(signal);
  if (head[0] === 0x50 && head[1] === 0x4b) return zipSource(file, options);
  // Rar!, 7z, tar, ... anything libarchive recognises; it reports corruption itself.
  return archiveSource(file, options);
}

export function imagesSource(urls: string[], names: string[]): PageSource {
  const items = urls.map((url, i) => ({ url, name: names[i] ?? baseName(url) })).filter((x) => isPageName(x.name));
  return {
    names: items.map((x) => x.name),
    async load(i) {
      const item = items[i]!;
      let res: Response;
      try {
        res = await fetch(item.url);
      } catch (e) {
        throw new EngineError('network', `Could not read ${item.name}`, { cause: e });
      }
      if (!res.ok) throw new EngineError('network', `${res.status} ${res.statusText}`.trim());
      return typed(await res.blob(), item.name);
    },
    close() {},
  };
}

// ---------------------------------------------------------------------------------------------
// CBZ
// ---------------------------------------------------------------------------------------------

let zipConfigured = false;

async function zipSource(file: RangeFile, options: OpenOptions): Promise<PageSource> {
  if (!zipConfigured) {
    // Inflate on the main thread through the browser's native streams: no blob: workers (CSP) needed.
    configure({ useWebWorkers: false });
    zipConfigured = true;
  }
  const reader = new ZipReader(new ZipRangeReader(file));
  let all: Entry[];
  try {
    all = await reader.getEntries();
  } catch (e) {
    throw new EngineError('corrupt', 'This comic archive is damaged and could not be read.', { cause: e });
  }
  const files = all.filter((e): e is FileEntry => !e.directory);
  const byName = new Map(files.filter((e) => isPageName(e.filename)).map((e) => [e.filename, e]));
  const names = [...byName.keys()].sort(naturalCompare);
  if (!names.length) throw new EngineError('unsupported-format', 'This archive does not contain any images.');

  let password: string | undefined;
  const first = byName.get(names[0]!)!;
  if (first.encrypted) {
    if (!options.requestPassword) throw new EngineError('password-required');
    for (let retry = false; ; retry = true) {
      const pw = await options.requestPassword(retry);
      if (pw == null) throw new EngineError('password-cancelled');
      try {
        await first.getData(new BlobWriter(), { password: pw });
        password = pw;
        break;
      } catch (e) {
        if (!/password/i.test(String((e as Error)?.message))) throw new EngineError('corrupt', undefined, { cause: e });
      }
    }
  }

  let comicInfo: string | undefined;
  const info = files.find((e) => isComicInfo(e.filename));
  if (info) comicInfo = await info.getData(new TextWriter(), { password }).catch(() => undefined);

  return {
    names,
    comicInfo,
    async load(i) {
      const name = names[i]!;
      try {
        return await byName.get(name)!.getData(new BlobWriter(mimeFor(name)), { password });
      } catch (e) {
        throw new EngineError('corrupt', `Page ${i + 1} could not be extracted`, { cause: e });
      }
    },
    close() {
      void reader.close().catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------------------------
// CBR and other libarchive formats
// ---------------------------------------------------------------------------------------------

interface LibEntry {
  file: { name: string; extract(): Promise<File> };
  path: string;
}
interface LibArchive {
  getFilesArray(): Promise<LibEntry[]>;
  hasEncryptedData(): Promise<boolean | null>;
  usePassword(p: string): Promise<void>;
  close(): Promise<void>;
}

let libReady: Promise<typeof import('libarchive.js')> | undefined;

/** libarchive's worker and WASM live in public/libarchive (copied by scripts/libarchive-assets.mjs); the worker resolves the .wasm next to itself. */
function loadLibarchive() {
  libReady ??= import('libarchive.js').then((m) => {
    m.Archive.init({ workerUrl: new URL(`${import.meta.env.BASE_URL}libarchive/worker-bundle.js`, document.baseURI).href });
    return m;
  });
  return libReady;
}

async function archiveSource(file: RangeFile, options: OpenOptions): Promise<PageSource> {
  const { Archive } = await loadLibarchive();
  let archive: LibArchive;
  try {
    const blob = await file.blob();
    aborted(options.signal);
    archive = (await Archive.open(new File([blob], 'comic.cbr'))) as unknown as LibArchive;
  } catch (e) {
    if (e instanceof EngineError) throw e;
    throw new EngineError('corrupt', 'This comic archive is damaged and could not be read.', { cause: e });
  }
  const bail = async (err: EngineError): Promise<never> => {
    await archive.close().catch(() => {});
    throw err;
  };

  const list = async () => (await archive.getFilesArray()).map((x) => ({ ...x, full: `${x.path}${x.file.name}` }));
  let listed: (LibEntry & { full: string })[] = [];
  let encrypted: boolean | null = null;
  try {
    encrypted = await archive.hasEncryptedData();
  } catch {
    encrypted = null;
  }

  // libarchive cannot decrypt RAR5 (it neither reports it nor fails: extraction just yields noise),
  // so a page that does not start like an image means "locked".
  const readable = async (): Promise<boolean> => {
    const probe = listed.find((x) => isPageName(x.full));
    if (!probe) return true;
    try {
      return looksLikeImage(new Uint8Array(await (await probe.file.extract()).slice(0, 16).arrayBuffer()));
    } catch {
      return false;
    }
  };
  const locked = new EngineError('unsupported-format', 'This RAR archive is password protected, which Quire cannot open yet.');

  if (encrypted) {
    if (!options.requestPassword) return bail(new EngineError('password-required'));
    for (let retry = false; ; retry = true) {
      const pw = await options.requestPassword(retry);
      if (pw == null) return bail(new EngineError('password-cancelled'));
      await archive.usePassword(pw);
      try {
        listed = await list();
        if (await readable()) break;
      } catch {
        // wrong password: ask again
      }
    }
  } else {
    try {
      listed = await list();
    } catch (e) {
      return bail(new EngineError('corrupt', 'This comic archive is damaged and could not be read.', { cause: e }));
    }
    if (!(await readable())) return bail(locked);
  }

  const byName = new Map(listed.filter((x) => isPageName(x.full)).map((x) => [x.full, x]));
  const names = [...byName.keys()].sort(naturalCompare);
  if (!names.length) return bail(new EngineError('unsupported-format', 'This archive does not contain any images.'));

  let comicInfo: string | undefined;
  const info = listed.find((e) => isComicInfo(e.full));
  if (info) comicInfo = await info.file.extract().then((f) => f.text(), () => undefined);

  // The worker is single-threaded; queue extractions so a burst of preloads cannot interleave.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    names,
    comicInfo,
    load(i) {
      const name = names[i]!;
      const run = chain.then(async () => {
        try {
          return typed(await byName.get(name)!.file.extract(), name);
        } catch (e) {
          throw new EngineError('corrupt', `Page ${i + 1} could not be extracted`, { cause: e });
        }
      });
      chain = run.catch(() => {});
      return run;
    },
    close() {
      void archive.close().catch(() => {});
    },
  };
}
