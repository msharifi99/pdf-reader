// Web-layer timings (production build, fake core, Chromium = WebView2's engine). Writes test-results/perf-web.json;
// scripts/perf/run.mjs compares it with the budget and only warns. Nothing here fails on a slow machine.
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { serveLarge } from '../e2e/helpers/large-pdf';

const out: Record<string, number> = {};
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;

// written after every test: a worker restart after a failure must not lose the earlier numbers
test.afterEach(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/perf-web.json', JSON.stringify(out, null, 2));
});
test.setTimeout(120_000);

test('library first-interactive', async ({ page }) => {
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.goto('/');
    await page.waitForFunction(() => performance.getEntriesByName('quire:library-interactive').length > 0);
    runs.push(await page.evaluate(() => performance.getEntriesByName('quire:library-interactive')[0]!.startTime));
  }
  out.libraryInteractiveMs = median(runs);
});

test('first page of the 2,000-page PDF', async ({ page }) => {
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.goto('/harness/pdf.html');
    await page.evaluate(() => (window as any).__h.open('big.pdf'));
    runs.push(await page.evaluate(() => (window as any).__h.timing.firstPaintMs));
  }
  out.bigPdfFirstPageMs = median(runs);
});

test('first page of the 600 MB PDF + long tasks while scrolling', async ({ page }) => {
  const { server } = await serveLarge(4598);
  try {
    await page.goto('/harness/pdf.html');
    await page.evaluate(() => {
      (window as any).__long = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (window as any).__long.push(e.duration))).observe({ entryTypes: ['longtask'] });
    });
    await page.evaluate(() => (window as any).__h.open('http://localhost:4598/large.pdf'));
    out.largePdfFirstPageMs = await page.evaluate(() => (window as any).__h.timing.firstPaintMs);
    await page.evaluate(() => ((window as any).__long.length = 0));
    await page.mouse.move(500, 400);
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(300);
    const long: number[] = await page.evaluate(() => (window as any).__long);
    out.scrollLongTasks = long.length;
    out.scrollLongestTaskMs = Math.max(0, ...long);
  } finally {
    server.close();
  }
});

test('EPUB page turn', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.goto('/harness/reflow.html');
  const times: number[] = await page.evaluate(async () => {
    const w = window as any;
    await w.__reflow.openBook('epub3.epub');
    await w.__reflow.engine.goTo(w.__reflow.tocFlat[0]);
    const e = w.__reflow.engine;
    e.setOptions({ animatePageTurns: false });
    await new Promise((r) => setTimeout(r, 400));
    const ts: number[] = [];
    for (let i = 0; i < 9; i++) {
      ts.push(await new Promise<number>((resolve) => {
        const off = e.on('relocated', () => { off(); resolve(performance.now() - t0); });
        setTimeout(() => resolve(NaN), 3000);
        const t0 = performance.now();
        void e.next();
      }));
      await new Promise((r) => setTimeout(r, 120));
    }
    return ts;
  });
  out.epubPageTurnMs = median(times.filter((t) => !Number.isNaN(t)));
});

test('comic page turn (cached)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/harness/comic.html');
  await page.evaluate(() => (window as any).__h.open('comic.cbz', {}));
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForFunction(() => (window as any).__h.engine.stats().cachedPages >= 3);
    times.push(await page.evaluate(() => (window as any).__h.timeTurn('next')));
  }
  out.comicPageTurnMs = median(times);
});
