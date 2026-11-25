import { type Page } from '@playwright/test';
import { expect, test } from './helpers/test';

/* The harness (harness/indexing.html) runs the real indexer, librarySearch and engines in-page
   against the fake core, with fixtures served from /fixtures. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type W = any;

async function boot(page: Page, fixtures: string[]) {
  await page.goto('/harness/indexing.html');
  await page.waitForFunction(() => !!(window as W).__h);
  return page.evaluate((f) => (window as W).__h.addFixtures(f) as string[], fixtures);
}

test('indexes the PDF and EPUB fixtures; library search finds known phrases and the locator opens there', async ({ page }) => {
  const [pdfId, epubId] = await boot(page, ['pdf/text.pdf', 'reflow/epub3.epub']);
  const outcome = await page.evaluate(() => (window as W).__h.indexing.indexLibraryNow());
  expect(outcome).toBe('idle');
  const status = await page.evaluate(() => (window as W).__h.core.indexStatus());
  expect(status).toMatchObject({ done: 2, total: 2, failed: 0 });
  expect(status.books.every((b: any) => b.chunks > 0)).toBe(true);

  // PDF: "Quire phrase page 8" is drawn on page index 7; the hit's locator opens that page.
  const pdf = await page.evaluate(async () => (window as W).__h.indexing.librarySearch('"Quire phrase page 8"', { debounceMs: 0 }));
  expect(pdf).toHaveLength(1);
  expect(pdf[0].bookId).toBe(pdfId);
  const hit = pdf[0].hits[0];
  expect(hit.locator).toMatchObject({ kind: 'fixed', page: 7 });
  expect(hit.segments.some((s: any) => s.match && /quire/i.test(s.text))).toBe(true);
  expect(hit.text).not.toContain('<mark>');
  const landed = await page.evaluate(([id, loc]) => (window as W).__h.openAt(id, loc), [pdfId, hit.locator] as const);
  expect(landed.location.locator.page).toBe(7);

  // EPUB: the located chunk, read through the engine from the locator, contains the phrase.
  const epub = await page.evaluate(async () => (window as W).__h.indexing.librarySearch('truth universally acknowledged', { debounceMs: 0 }));
  expect(epub.map((b: any) => b.bookId)).toEqual([epubId]);
  const eh = epub[0].hits[0];
  expect(eh.locator.kind).toBe('reflow');
  await page.evaluate(([id, loc]) => (window as W).__h.openAt(id, loc), [epubId, eh.locator] as const);
  const text = await page.evaluate(async (loc) => {
    let out = '';
    for await (const c of (window as W).__h.engine.textStream(loc)) {
      out += ` ${c.text}`;
      if (out.length > 2500) break;
    }
    return out;
  }, eh.locator);
  expect(text.replace(/\s+/g, ' ').toLowerCase()).toContain('truth universally acknowledged');
});

test('prefix, phrase and hostile queries behave', async ({ page }) => {
  await boot(page, ['reflow/epub3.epub']);
  await page.evaluate(() => (window as W).__h.indexing.indexLibraryNow());
  const q = (s: string) => page.evaluate(async (x) => (window as W).__h.indexing.librarySearch(x, { debounceMs: 0 }), s);
  expect(await q('universally ackn')).toHaveLength(1); // prefix on the word being typed
  expect(await q('"universally acknowledged"')).toHaveLength(1);
  expect(await q('"acknowledged universally"')).toHaveLength(0); // phrase order matters
  for (const bad of ['"', '-', 'AND(', 'NEAR(', '"unterminated', '*', ')(', 'a" b']) expect(await q(bad)).toBeDefined();
  expect(await q('')).toEqual([]);
});

test('a newer search supersedes the older one and cancel resolves null', async ({ page }) => {
  await boot(page, ['reflow/epub3.epub']);
  await page.evaluate(() => (window as W).__h.indexing.indexLibraryNow());
  const r = await page.evaluate(async () => {
    const { librarySearch, cancelLibrarySearch } = (window as W).__h.indexing;
    const first = librarySearch('truth', { debounceMs: 50 });
    const second = librarySearch('truth universally', { debounceMs: 50 });
    const third = librarySearch('whale', { debounceMs: 200 });
    cancelLibrarySearch();
    return [await first, await second, await third];
  });
  expect(r).toEqual([null, null, null]);
});

test('the indexer waits while the user is reading and carries on afterwards', async ({ page }) => {
  await boot(page, ['pdf/text.pdf', 'reflow/epub3.epub']);
  const r = await page.evaluate(async () => {
    const h = (window as W).__h;
    h.indexing.setReadingActive(true);
    await new Promise((res) => setTimeout(res, 50));
    const gate = new h.indexing.PauseGate();
    await gate.start(); // picks up the core's flag
    const paused = gate.paused;
    const run = h.indexing.runIndexer({ gate, throttleMs: 0, betweenMs: 0 });
    await new Promise((res) => setTimeout(res, 600));
    const whilePaused = (await h.core.indexStatus()).done;
    h.indexing.setReadingActive(false);
    const outcome = await run;
    const after = await h.core.indexStatus();
    return { paused, whilePaused, outcome, done: after.done, flag: h.fake().isReading() };
  });
  expect(r).toMatchObject({ paused: true, whilePaused: 0, outcome: 'idle', done: 2, flag: false });
});

test('a corrupt book is recorded as failed once and never retried', async ({ page }) => {
  const [bad, good] = await boot(page, ['pdf/corrupt.pdf', 'reflow/epub3.epub']);
  const r = await page.evaluate(async () => {
    const h = (window as W).__h;
    const seen: string[] = [];
    await h.indexing.runIndexer({ throttleMs: 0, betweenMs: 0, onBook: (b: any, o: any) => seen.push(`${b.id}:${'error' in o ? 'error' : 'ok'}`) });
    const status = await h.core.indexStatus();
    const needing = (await h.core.booksNeedingIndex(10)).length;
    return { seen, status, needing };
  });
  expect(r.seen.sort()).toEqual([`${bad}:error`, `${good}:ok`].sort());
  expect(r.status).toMatchObject({ done: 1, failed: 1, total: 2 });
  expect(r.status.books.find((b: any) => b.bookId === bad).error).toBeTruthy();
  expect(r.needing).toBe(0);
});
