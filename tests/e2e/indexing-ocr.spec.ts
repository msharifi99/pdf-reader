import { expect, test, type Page } from '@playwright/test';

/* OCR end to end in fake mode: a rendered scan (public/fixtures/pdf/scanned.pdf, image-only), the real page
   rendering + RGBA transfer path, Windows OCR mocked with fixed boxes, then PDF-engine search over the result. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type W = any;

const WORDS = [
  { text: 'QUIRE', x: 0.07, y: 0.09, width: 0.28, height: 0.06 },
  { text: 'READS', x: 0.38, y: 0.09, width: 0.28, height: 0.06 },
  { text: 'SCANS', x: 0.7, y: 0.09, width: 0.25, height: 0.06 },
];

async function boot(page: Page) {
  await page.goto('/harness/indexing.html');
  await page.waitForFunction(() => !!(window as W).__h);
  const [id] = await page.evaluate(() => (window as W).__h.addFixtures(['pdf/scanned.pdf']) as string[]);
  await page.evaluate((w) => {
    const h = (window as W).__h;
    (window as W).__seen = [];
    h.fake().setOcr((req: any) => {
      let dark = 0;
      for (let i = 0; i < req.pixels.length; i += 4) if (req.pixels[i] < 100) dark++;
      (window as W).__seen.push({ page: req.page, w: req.width, h: req.height, bytes: req.pixels.length, dark });
      return w;
    });
  }, WORDS);
  return id;
}

test('a scanned PDF has no text until OCR; OCR makes the PDF engine search it, once', async ({ page }) => {
  const id = await boot(page);
  const opened = await page.evaluate((i) => (window as W).__h.openForOcr(i), id);
  expect(opened.handle.hasText).toBe(false);
  expect(opened.state).toMatchObject({ scanned: true, complete: false, pagesDone: 0, pageCount: 2 });
  const before = await page.evaluate(async () => {
    let n = 0;
    for await (const _ of (window as W).__h.engine.search('reads')) n++;
    return n;
  });
  expect(before).toBe(0);

  const progress = await page.evaluate(async (i) => {
    const h = (window as W).__h;
    const log: any[] = [];
    const job = h.indexing.ocr.start(i, h.engine, { pageCount: 2, onProgress: (p: any) => log.push(p) });
    const result = await job.done;
    return { result, log };
  }, id);
  expect(progress.result).toEqual({ pages: 2, failed: 0, cancelled: false });
  expect(progress.log.map((p: any) => p.done)).toEqual([1, 2]);

  // The page bitmap was sent raw at ~2000 px tall, RGBA, with visible text on a white page.
  const seen = await page.evaluate(() => (window as W).__seen);
  expect(seen).toHaveLength(2);
  expect(seen[0].h).toBeGreaterThanOrEqual(1990);
  expect(seen[0].h).toBeLessThanOrEqual(2010);
  expect(seen[0].bytes).toBe(seen[0].w * seen[0].h * 4);
  expect(seen[0].dark).toBeGreaterThan(5000);

  // Search (engine-level) finds the OCR'd word on both pages, with quads in PDF points.
  const hits = await page.evaluate(async () => {
    const out: any[] = [];
    for await (const h of (window as W).__h.engine.search('reads')) out.push({ page: h.locator.page, quads: h.anchor.pdfQuads });
    return out;
  });
  expect(hits.map((h) => h.page)).toEqual([0, 1]);
  const [x, y, w, hh] = hits[0].quads[0];
  expect(x).toBeCloseTo(0.38 * 595, 0); // normalised box -> page points (A4 595 x 842)
  expect(y).toBeCloseTo(0.09 * 842, 0);
  expect(w).toBeGreaterThan(100);
  expect(hh).toBeGreaterThan(30);
  // A synthetic text layer exists in the DOM for selection and copy.
  await expect(page.locator('.q-ocr span').first()).toHaveText(/QUIRE|READS|SCANS/);

  // The OCR text is in the library index straight away.
  const found = await page.evaluate(async () => (window as W).__h.indexing.librarySearch('reads scans', { debounceMs: 0 }));
  expect(found[0].bookId).toBe(id);
  expect(found[0].hits[0].locator).toMatchObject({ kind: 'fixed', page: 0 });

  // Reopen: cached OCR is applied at once and nothing is left to do (OCR runs once per book).
  const again = await page.evaluate(async (i) => {
    const h = (window as W).__h;
    const r = await h.openForOcr(i);
    let n = 0;
    for await (const _ of h.engine.search('scans')) n++;
    return { state: r.state, n, calls: (window as W).__seen.length };
  }, id);
  expect(again.state).toMatchObject({ complete: true, pagesDone: 2 });
  expect(again.n).toBe(2);
  expect(again.calls).toBe(2); // no new OCR requests
});

test('OCR can be paused, resumed and cancelled between pages', async ({ page }) => {
  const id = await boot(page);
  await page.evaluate((i) => (window as W).__h.openForOcr(i), id);
  const r = await page.evaluate(async (i) => {
    const h = (window as W).__h;
    const job = h.indexing.ocr.start(i, h.engine, { pageCount: 2, idleMs: 0 });
    job.pause();
    await new Promise((res) => setTimeout(res, 400));
    const whilePaused = (await h.core.getOcrPages(i)).length;
    job.resume();
    await job.done;
    const afterResume = (await h.core.getOcrPages(i)).length;

    await h.core.clearOcr(i);
    const job2 = h.indexing.ocr.start(i, h.engine, { pageCount: 2, idleMs: 0 });
    job2.cancel();
    const res = await job2.done;
    return { whilePaused, afterResume, cancelled: res.cancelled, pages: res.pages };
  }, id);
  expect(r.whilePaused).toBe(0);
  expect(r.afterResume).toBe(2);
  expect(r.cancelled).toBe(true);
  expect(r.pages).toBe(0);
});

test('page-space mapping undoes page rotation', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const m = (window as W).__h.indexing.ocr.toPageSpace;
    const w = [{ text: 'x', x: 0.1, y: 0.2, width: 0.3, height: 0.05 }];
    return [0, 90, 180, 270].map((rotate) => m(w, { width: 100, height: 200, rotate })[0]);
  });
  const near = (a: any, b: any) => Object.keys(b).forEach((k) => expect(a[k]).toBeCloseTo(b[k], 6));
  near(r[0], { x: 10, y: 40, width: 30, height: 10 });
  near(r[1], { x: 0.2 * 100, y: (1 - 0.1 - 0.3) * 200, width: 0.05 * 100, height: 0.3 * 200 });
  near(r[2], { x: (1 - 0.1 - 0.3) * 100, y: (1 - 0.2 - 0.05) * 200, width: 30, height: 10 });
  near(r[3], { x: (1 - 0.2 - 0.05) * 100, y: 0.1 * 200, width: 0.05 * 100, height: 0.3 * 200 });
});

test('comics: OCR words become searchable and streamable; indexing picks them up', async ({ page }) => {
  await page.goto('/harness/indexing.html');
  await page.waitForFunction(() => !!(window as W).__h);
  const [id] = await page.evaluate(() => (window as W).__h.addFixtures(['comic/comic.cbz']) as string[]);
  const r = await page.evaluate(async ([i, words]) => {
    const h = (window as W).__h;
    h.fake().setOcr(() => words);
    const opened = await h.openForOcr(i);
    const before = { search: opened.handle.hasText, needing: (await h.core.booksNeedingIndex(5)).length };
    const job = h.indexing.ocr.start(i, h.engine, { pageCount: opened.handle.pageCount, idleMs: 0 });
    const res = await job.done;
    const hits: any[] = [];
    for await (const x of h.engine.search('reads')) hits.push(x.locator.page);
    const streamed: string[] = [];
    for await (const c of h.engine.textStream()) streamed.push(c.text);
    return { before, res, hits, streamed: streamed[0], pages: opened.handle.pageCount };
  }, [id, WORDS] as const);
  expect(r.before).toEqual({ search: false, needing: 0 }); // no text, so nothing to index yet
  expect(r.res.pages).toBe(r.pages);
  expect(r.hits.length).toBe(r.pages);
  expect(r.streamed).toBe('QUIRE READS SCANS');
});
