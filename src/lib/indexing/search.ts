/** Library-wide full-text search: debounced, cancellable, grouped by book. */
import type { TextHit } from '../core/bindings';
import { core } from '../core/core';
import type { Locator } from '../engines/types';

/** A piece of a snippet; render `match` pieces highlighted. Plain text only: never use innerHTML. */
export interface SnippetSegment {
  text: string;
  match: boolean;
}

export interface LibraryHit {
  /** Pass to `engine.goTo(locator)` after opening the book. */
  locator: Locator;
  segments: SnippetSegment[];
  /** The snippet without markup. */
  text: string;
}

export interface BookHits {
  bookId: string;
  title: string;
  /** Best match first. */
  hits: LibraryHit[];
}

export interface LibrarySearchOptions {
  /** Max passages overall (default 40). */
  limit?: number;
  /** Wait this long for more typing before querying (default 120 ms). */
  debounceMs?: number;
  /** Cancel from outside; the promise then resolves `null`. */
  signal?: AbortSignal;
}

/** `"a <mark>b</mark> c"` -> `[{a }, {b, match}, { c}]`. */
export function parseSnippet(snippet: string): SnippetSegment[] {
  const out: SnippetSegment[] = [];
  for (const [i, part] of snippet.split(/<\/?mark>/).entries()) if (part) out.push({ text: part, match: i % 2 === 1 });
  return out;
}

/** Group core hits by book, keeping the core's relevance order (a book sits where its best hit is). */
export function groupHits(hits: TextHit[]): BookHits[] {
  const books = new Map<string, BookHits>();
  for (const h of hits) {
    let b = books.get(h.bookId);
    if (!b) books.set(h.bookId, (b = { bookId: h.bookId, title: h.bookTitle, hits: [] }));
    const segments = parseSnippet(h.snippet);
    b.hits.push({ locator: h.locator as Locator, segments, text: segments.map((s) => s.text).join('') });
  }
  return [...books.values()];
}

let latest = 0;
let supersede: (() => void) | null = null;

/** Drop the search in flight (its promise resolves `null`). */
export function cancelLibrarySearch(): void {
  latest++;
  supersede?.();
}

/**
 * Search the text of every indexed book. Call it on every keystroke: a newer call supersedes the
 * older one, whose promise resolves `null` (ignore `null`). Supports `prefix` (the word being
 * typed), `"exact phrases"` and plain words (all must match); no query syntax can error. An empty
 * query resolves `[]` immediately.
 */
export async function librarySearch(query: string, opts: LibrarySearchOptions = {}): Promise<BookHits[] | null> {
  cancelLibrarySearch();
  const mine = latest;
  if (!query.trim()) return [];
  const cancelled = new Promise<void>((r) => {
    supersede = r;
    opts.signal?.addEventListener('abort', () => r(), { once: true });
  });
  const stale = () => mine !== latest || !!opts.signal?.aborted;
  await Promise.race([new Promise((r) => setTimeout(r, opts.debounceMs ?? 120)), cancelled]);
  if (stale()) return null;
  const hits = await core.searchLibraryText(query, opts.limit ?? 40);
  return stale() ? null : groupHits(hits);
}
