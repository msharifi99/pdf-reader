/**
 * Cross-cutting app state: which view is showing and which book is open.
 *
 *   import { app, openDocument, closeBook } from '../stores/app.svelte';
 *   app.view            'library' | 'reader'
 *   app.book            the open book (null in the library)
 *   await openDocument(pathOrFile)   // library click, Ctrl+O, drop, launch file. Never throws:
 *   await openDocument(path, { locator })  // open at a position (library search hit) -> app.book.initialLocator
 *                                    // failures show the calm error dialog; resolves false.
 *   closeBook()         // back to the library
 *
 * Feature areas keep their own stores.
 */
import type { BookFormat, BookSource, Locator } from '../engines/types';
import { sniffSource } from '../engines/sniff';
import { core, fileUrl } from '../core/core';
import { presentError, ShellError } from '../shell/errors.svelte';

export type AppView = 'library' | 'reader';

export interface OpenBook {
  /** Library id (from the core) or a synthetic `file:` / `path:` id for ad-hoc files. */
  id: string;
  /** Absolute path when known (absent for browser File objects). */
  path?: string;
  title: string;
  format: BookFormat;
  /** What to hand an Engine's `open()`. */
  source: BookSource;
  /** Saved progress from the core's `open_document`, if any (Progress JSON). */
  progress?: unknown;
  /** When a single image was opened: that image's path (the book is its folder). */
  startImage?: string | null;
  /** Open here instead of the saved position (library full-text hit, deep link). The reader goes to it once. */
  initialLocator?: Locator;
}

export const app = $state<{ view: AppView; book: OpenBook | null; version: string; opening: boolean }>({
  view: 'library',
  book: null,
  version: '',
  opening: false,
});

export function openBook(book: OpenBook): void {
  revoke();
  app.book = book;
  app.view = 'reader';
}

export function closeBook(): void {
  revoke();
  app.book = null;
  app.view = 'library';
}

function revoke() {
  const s = app.book?.source;
  if (s?.kind === 'file' && s.url.startsWith('blob:')) URL.revokeObjectURL(s.url);
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stripExt = (n: string) => n.replace(/\.[a-z0-9]{2,5}$/i, '');

let seq = 0;

/** Open a document from a path (Tauri) or a browser File (fake mode, drag-drop in dev). */
export async function openDocument(input: string | File, opts: { locator?: Locator } = {}): Promise<boolean> {
  const name = typeof input === 'string' ? baseName(input) : input.name;
  const mine = ++seq;
  app.opening = true;
  try {
    const book = typeof input === 'string' ? await fromPath(input) : await fromFile(input);
    if (mine !== seq) return false; // a newer open won
    if (opts.locator) book.initialLocator = opts.locator;
    openBook(book);
    return true;
  } catch (err) {
    if (mine === seq) presentError(err, { fileName: name });
    return false;
  } finally {
    if (mine === seq) app.opening = false;
  }
}

async function fromFile(file: File): Promise<OpenBook> {
  const sniffed = await sniffSource(file);
  if (!sniffed.format) throw new ShellError('unsupported');
  const url = URL.createObjectURL(file);
  return {
    id: `file:${file.name}:${file.size}`,
    title: stripExt(file.name),
    format: sniffed.format,
    source: { kind: 'file', url, format: sniffed.format, fileName: file.name, byteLength: file.size },
  };
}

async function fromPath(path: string): Promise<OpenBook> {
  // the core adds (or re-links) the book and rejects with {code, message} on failure
  const r = await core.openDocument(path);
  const b = r.book;
  return {
    id: b.id,
    path: b.path ?? path,
    title: b.title || stripExt(baseName(path)),
    format: b.format,
    source: { kind: 'file', url: fileUrl({ bookId: b.id }), format: b.format, fileName: baseName(path), byteLength: b.fileSize },
    progress: r.progress ?? undefined,
    startImage: r.startImage ?? null,
  };
}
