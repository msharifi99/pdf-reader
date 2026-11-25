// Dev/test harness for indexing + OCR (not part of the app). Runs the real indexer, library search and OCR
// pipeline in-page against the fake core. Exposes window.__h for Playwright.
import { core, initCore } from '../src/lib/core/core';
import { cancelLibrarySearch, indexLibraryNow, indexProgress, librarySearch, ocr, setReadingActive } from '../src/lib/indexing';
import { PauseGate, indexBook, runIndexer } from '../src/lib/indexing/indexer';
import { openBookHeadless } from '../src/lib/indexing/open';
import type { Engine, Locator } from '../src/lib/engines/types';

await initCore();
const stage = document.getElementById('stage')!;
const fake = () => (globalThis as unknown as { __QUIRE_FAKE__: Record<string, (...a: never[]) => unknown> }).__QUIRE_FAKE__;

const h = {
  core,
  indexing: { cancelLibrarySearch, indexLibraryNow, indexProgress, librarySearch, ocr, setReadingActive, PauseGate, indexBook, runIndexer },
  fake,
  engine: null as Engine | null,
  /** Add fixture books ("pdf/text.pdf") to the fake library and return their ids. */
  addFixtures(names: string[]): string[] {
    return names.map((n) => fake().addFixture(n as never) as string);
  },
  /** Open a library book in a visible engine and jump to `locator`; returns where it landed. */
  async openAt(bookId: string, locator: Locator) {
    h.engine?.dispose();
    stage.replaceChildren();
    const book = await core.getBook(bookId);
    const { engine, handle } = await openBookHeadless(book);
    h.engine = engine;
    await engine.render(stage, locator);
    await engine.goTo(locator);
    return { location: engine.getLocation(), hasText: handle.hasText };
  },
  /** Open a library book (no render) and apply cached OCR, like the reader will. */
  async openForOcr(bookId: string) {
    h.engine?.dispose();
    stage.replaceChildren();
    const book = await core.getBook(bookId);
    const { engine, handle } = await openBookHeadless(book);
    h.engine = engine;
    await engine.render(stage);
    const state = await ocr.prepare(bookId, engine, handle);
    return { handle: { hasText: handle.hasText, pageCount: handle.pageCount }, state };
  },
};
(window as unknown as { __h: typeof h }).__h = h;
