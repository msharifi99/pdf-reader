/**
 * Search, indexing and OCR: the API for the UI.
 *
 * Library-wide search (library screen):
 *   const groups = await librarySearch('whale oil');   // BookHits[] | null (null = superseded, ignore)
 *   groups[0].hits[0].segments  // snippet pieces, `match` ones highlighted (never innerHTML)
 *   groups[0].hits[0].locator   // open the book, then `engine.goTo(locator)`
 *
 * Indexing status ("Indexing 12 of 40 books"):
 *   await indexProgress.start();  indexProgress.done / total / failed / active / fraction / paused
 *
 * Tell the indexer when the user is reading (reader shell: true on open, false on close):
 *   setReadingActive(true);
 *
 * OCR (reader shell, after `engine.open()`):
 *   const s = await ocr.prepare(bookId, engine, handle);    // applies cached OCR, no work if done
 *   if (s.scanned && !s.complete) showOffer(); on accept:
 *   const job = ocr.start(bookId, engine, { pageCount: handle.pageCount!, onProgress });
 *   // job.pause() / resume() / cancel(); await job.done;  (rejects if Windows has no OCR language)
 *
 * Playwright / fake core: `await indexLibraryNow()` runs the real indexer in-page over the fake
 * core's books; `window.__QUIRE_FAKE__.setOcr(fn)` mocks Windows OCR.
 */
import { core } from '../core/core';
import { runIndexer } from './indexer';

export { librarySearch, cancelLibrarySearch, groupHits, parseSnippet } from './search';
export type { BookHits, LibraryHit, LibrarySearchOptions, SnippetSegment } from './search';
export { indexProgress } from './progress.svelte';
export { ocr, detectScanned, prepare as prepareOcr, start as startOcr, languages as ocrLanguages } from './ocr';
export type { OcrJob, OcrOptions, OcrProgress, OcrResult, OcrState } from './ocr';

let lastReading: boolean | undefined;

/** The reader has a book open and is being used: the background indexer pauses (and resumes on `false`). */
export function setReadingActive(active: boolean): void {
  if (active === lastReading) return;
  lastReading = active;
  void core.setReadingActive(active).catch(() => {});
}

/** Index every pending book right now, in this window, without the pause gate or throttling (tests, fake mode). */
export function indexLibraryNow(): Promise<'idle' | 'restart' | 'aborted'> {
  return runIndexer({ throttleMs: 0, betweenMs: 0 });
}
