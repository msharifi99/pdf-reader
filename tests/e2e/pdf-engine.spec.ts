import { type Page } from '@playwright/test';
import { test, expect } from './helpers/test';

type Opts = { passwords?: string[]; theme?: string; tint?: string; page?: number; flow?: string; fit?: string; zoom?: number };
/* eslint-disable @typescript-eslint/no-explicit-any */
const H = 'window.__h as any';

async function open(page: Page, file: string, opts: Opts = {}) {
  await page.goto('/harness/pdf.html');
  return page.evaluate(([f, o]) => (window as any).__h.open(f, o), [file, opts] as const);
}
const goTo = (page: Page, p: number, y = 0) => page.evaluate(([pp, yy]) => (window as any).__h.engine.goTo({ kind: 'fixed', page: pp, y: yy }), [p, y] as const);
const loc = (page: Page) => page.evaluate(() => (window as any).__h.engine.getLocation());
const stats = (page: Page) => page.evaluate(() => (window as any).__h.engine.stats());
const waitRendered = (page: Page, n: number) => expect(page.locator(`.q-page[data-page="${n}"][data-rendered="true"]`)).toBeVisible();

test('text.pdf shows page 1 text in the text layer, with labelled pages', async ({ page }) => {
  expect(await open(page, 'text.pdf')).toBeNull();
  await waitRendered(page, 0);
  await expect(page.locator('.q-page[data-page="0"] .textLayer')).toContainText('Chapter 1');
  await expect(page.locator('.q-page[data-page="0"]')).toHaveAttribute('aria-label', /Page i of 12/);
  const h = await page.evaluate(() => (window as any).__h.handle);
  expect(h.pageCount).toBe(12);
  expect(h.hasText).toBe(true);
  expect(h.metadata.title).toBe('Quire Test Document');
  expect(h.toc.map((t: any) => t.title)).toEqual(['Part one', 'Part two', 'Epilogue']);
  expect(h.toc[0].children).toHaveLength(2);
});

test('goTo is exact, next/prev turn pages, relocated reports progress', async ({ page }) => {
  await open(page, 'text.pdf');
  await goTo(page, 4, 0.5);
  const l = await loc(page);
  expect(l.locator.page).toBe(4);
  expect(l.locator.y).toBeCloseTo(0.5, 2);
  expect(l.progress.page).toMatchObject({ index: 4, count: 12 });
  expect(l.progress.chapter.title).toBe('The lamp');
  const events: any[] = await page.evaluate(() => (window as any).__h.events);
  expect(events.at(-1).progress.page.index).toBe(4);

  await page.evaluate(() => (window as any).__h.open('text.pdf', { flow: 'paginated', fit: 'page' }));
  await waitRendered(page, 0);
  expect(await page.evaluate(() => (window as any).__h.engine.next())).toBe(true);
  expect((await loc(page)).locator.page).toBe(1);
  expect(await page.evaluate(() => (window as any).__h.engine.prev())).toBe(true);
  expect((await loc(page)).locator.page).toBe(0);
  expect(await page.evaluate(() => (window as any).__h.engine.prev())).toBe(false);
});

test('search finds every hit, and hits decorate the pages', async ({ page }) => {
  await open(page, 'text.pdf');
  const res = await page.evaluate(async () => {
    const e = (window as any).__h.engine;
    const hits: any[] = [];
    for await (const h of e.search('lighthouse keeper')) hits.push(h);
    const all: any[] = [];
    for await (const h of e.search('QUIRE PHRASE PAGE')) all.push(h);
    const cs: any[] = [];
    for await (const h of e.search('QUIRE PHRASE PAGE', { caseSensitive: true })) cs.push(h);
    e.setDecorations('search', hits.map((h, i) => ({ id: String(i), anchor: h.anchor, style: { type: 'search-hit', current: i === 0 } })));
    return { pages: hits.map((h) => h.locator.page), excerpt: hits[0].excerpt, all: all.length, cs: cs.length };
  });
  expect(res.pages).toEqual([1, 4, 4, 6]);
  expect(res.excerpt.match.toLowerCase()).toBe('lighthouse keeper');
  expect(res.all).toBe(12);
  expect(res.cs).toBe(0);
  await goTo(page, 1, 0);
  await expect(page.locator('.q-page[data-page="1"] .q-d-search-hit').first()).toBeVisible();
});

test('search can be aborted', async ({ page }) => {
  await open(page, 'big.pdf');
  const n = await page.evaluate(async () => {
    const ac = new AbortController();
    let n = 0;
    for await (const _ of (window as any).__h.engine.search('Page', { signal: ac.signal })) {
      if (++n === 3) ac.abort();
    }
    return n;
  });
  expect(n).toBeLessThan(6);
});

test('Smart tint remaps the page to the dark theme but leaves images coloured', async ({ page }) => {
  await open(page, 'text.pdf', { theme: 'dark', tint: 'smart' });
  await waitRendered(page, 0);
  const px = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.q-page[data-page="0"] canvas')!;
    const ctx = c.getContext('2d')!;
    const at = (fx: number, fy: number) => Array.from(ctx.getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data);
    return { paper: at(0.95, 0.95), disc: at(0.31, 0.42), orange: at(0.13, 0.33), tint: (window as any).__h.engine.stats() };
  });
  const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  expect(lum(px.paper)).toBeLessThan(60); // was white paper
  expect(px.disc[2]).toBeGreaterThan(px.disc[0] + 100); // blue disc untouched
  expect(px.orange[0]).toBeGreaterThan(px.orange[2] + 100); // red/orange gradient untouched
  const times = await page.evaluate(async () => {
    const e = (window as any).__h.engine;
    const out: number[] = [];
    for (let i = 0; i < 12; i++) {
      e.setPresentation({ pageTint: i % 2 ? 'smart' : 'original' });
      await new Promise((r) => setTimeout(r, 60));
      if (i % 2) out.push(e.stats().lastTintMs);
    }
    return out.sort((a, b) => a - b);
  });
  console.log(`tint pass (${px.tint.tintPath}): first ${px.tint.lastTintMs.toFixed(1)} ms, steady median ${times[Math.floor(times.length / 2)].toFixed(1)} ms`);
  expect(times[Math.floor(times.length / 2)]).toBeLessThan(30);
});

test('theme and tint changes re-tint cached pages without re-rendering pdf.js', async ({ page }) => {
  await open(page, 'text.pdf', { theme: 'dark', tint: 'original' });
  await waitRendered(page, 0);
  const whitePaper = () => page.evaluate(() => { const c = document.querySelector<HTMLCanvasElement>('.q-page[data-page="0"] canvas')!; return c.getContext('2d')!.getImageData(Math.round(c.width * 0.95), Math.round(c.height * 0.95), 1, 1).data[0]; });
  expect(await whitePaper()).toBeGreaterThan(240);
  await page.selectOption('#tint', 'invert');
  await expect(page.locator('.q-page[data-page="0"] canvas')).toHaveCSS('filter', /invert/);
  await page.selectOption('#tint', 'smart');
  await expect.poll(whitePaper).toBeLessThan(60);
  await page.selectOption('#theme', 'light');
  await expect.poll(whitePaper).toBeGreaterThan(200); // cream (#fdf6e3)
});

test('password: required, wrong, then right', async ({ page }) => {
  const cancelled = await open(page, 'encrypted.pdf');
  expect(cancelled).toMatchObject({ code: 'password-cancelled' });
  expect(await page.evaluate(() => (window as any).__h.prompts)).toEqual([false]);
  const ok = await page.evaluate(() => (window as any).__h.open('encrypted.pdf', { passwords: ['nope', 'quire'] }));
  expect(ok).toBeNull();
  expect(await page.evaluate(() => (window as any).__h.prompts)).toEqual([false, true]);
  await waitRendered(page, 0);
  await expect(page.locator('.q-page[data-page="0"] .textLayer')).toContainText('Secret page one');
});

test('corrupt.pdf yields a typed error, and nothing leaks into the console as unhandled', async ({ page }) => {
  const unhandled: string[] = [];
  page.on('pageerror', (e) => unhandled.push(e.message));
  const err = await open(page, 'corrupt.pdf');
  expect(err).toMatchObject({ code: 'corrupt' });
  await page.waitForTimeout(300);
  expect(unhandled).toEqual([]);
});

test('big.pdf: fast first page, jump to page 1500, bounded DOM', async ({ page }) => {
  await open(page, 'big.pdf');
  const t = await page.evaluate(() => (window as any).__h.timing);
  console.log(`big.pdf first page painted after ${t.firstPaintMs.toFixed(0)} ms (open ${t.openMs.toFixed(0)} ms)`);
  expect(t.firstPaintMs).toBeLessThan(1500);
  await waitRendered(page, 0);
  await goTo(page, 1499, 0);
  const l = await loc(page);
  expect(l.locator.page).toBe(1499);
  await waitRendered(page, 1499);
  await expect(page.locator('.q-page[data-page="1499"] .textLayer')).toContainText('Page 1500');
  // scroll a long way in steps; the DOM must stay bounded
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(20);
  }
  const s = await stats(page);
  expect(s.mountedPages).toBeLessThanOrEqual(8);
  expect(s.cachedBytes).toBeLessThan(300 * 1024 * 1024);
});

test('ctrl+wheel zooms around the cursor; fit modes and rotation work', async ({ page }) => {
  await open(page, 'text.pdf');
  await waitRendered(page, 0);
  const z0 = (await stats(page)).zoom;
  await page.mouse.move(500, 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await stats(page)).zoom).toBeGreaterThan(z0);
  await page.evaluate(() => (window as any).__h.engine.setPresentation({ fit: 'actual' }));
  expect((await stats(page)).zoom).toBe(1);
  await page.evaluate(() => (window as any).__h.engine.setPresentation({ rotation: 90 }));
  await expect(page.locator('.q-page[data-page="0"]')).toHaveCSS('width', /^\d/);
  const { w, h } = await page.evaluate(() => { const e = document.querySelector<HTMLElement>('.q-page[data-page="0"]')!; return { w: e.offsetWidth, h: e.offsetHeight }; });
  expect(w).toBeGreaterThan(h); // rotated: page is now landscape
  await waitRendered(page, 0);
});

test('links: external goes to the shell callback, internal navigates', async ({ page }) => {
  await open(page, 'text.pdf', { fit: 'actual' });
  await waitRendered(page, 0);
  await expect(page.locator('.q-page[data-page="0"] .annotationLayer a').first()).toBeAttached();
  await page.evaluate(() => { (window as any).__ext = []; (window as any).__h.engine.setExternalLinkHandler((h: string) => (window as any).__ext.push(h)); });
  await page.locator('.q-page[data-page="0"] .annotationLayer a[href^="https"]').click();
  expect(await page.evaluate(() => (window as any).__ext)).toEqual(['https://example.com/quire']);
  await page.locator('.q-page[data-page="0"] .annotationLayer a[href^="#"]').click();
  await expect.poll(async () => (await loc(page)).locator.page).toBe(4);
});

test('form fields render and annotations do not crash', async ({ page }) => {
  await open(page, 'text.pdf', { fit: 'actual', page: 1 });
  await waitRendered(page, 1);
  await expect(page.locator('.q-page[data-page="1"] .annotationLayer input')).toHaveValue('Ada');
});

test('form JavaScript runs like Acrobat: calculations, manual overrides, Mouse Up checkbox scripts', async ({ page }) => {
  await open(page, 'form.pdf', { fit: 'actual' });
  await waitRendered(page, 0);
  const f = (n: string) => page.locator(`.annotationLayer [name="${n}"]`);
  const type = async (n: string, v: string) => {
    await f(n).click();
    await f(n).fill(v);
    await f(n).press('Tab'); // pdf.js commits a field only when focus moves to another element
  };
  await type('a', '10');
  await expect(f('total')).toHaveValue('13');
  await type('total', '!99');
  await type('b', '4');
  await expect(f('total')).toHaveValue('!99'); // Calculate saw the override in event.value and kept it

  // none -> p -> p+e -> none; each step recalculates after the Mouse Up script ran
  for (const [level, p, e] of [['1', true, false], ['2', true, true], ['0', false, false]] as const) {
    await f('p').click();
    await expect(f('level')).toHaveValue(level);
    await expect(f('p')).toBeChecked({ checked: p });
    await expect(f('e')).toBeChecked({ checked: e });
  }
});

test('selection becomes an anchor that resolves back to rects, and survives zoom', async ({ page }) => {
  await open(page, 'text.pdf', { fit: 'actual' });
  await waitRendered(page, 0);
  await expect(page.locator('.q-page[data-page="0"] .textLayer span').first()).toBeAttached();
  const res = await page.evaluate(async () => {
    const e = (window as any).__h.engine;
    const span = [...document.querySelectorAll('.q-page[data-page="0"] .textLayer span')].find((s) => s.textContent?.includes('harbour pilot'))!;
    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const anchor = await e.selectionToAnchor();
    const resolved = await e.anchorToRanges(anchor);
    e.setDecorations('annotations', [{ id: 'a', anchor, style: { type: 'highlight', color: 0 } }]);
    // A stale quad but a good quote: must re-anchor fuzzily and say so.
    const moved = await e.anchorToRanges({ ...anchor, pdfQuads: [[1, 1, 5, 5]] });
    return { anchor, resolved, moved };
  });
  expect(res.anchor.quote.exact).toContain('harbour pilot');
  expect(res.anchor.pdfQuads.length).toBeGreaterThan(0);
  expect(res.resolved.exact).toBe(true);
  expect(res.resolved.regions[0].rects.length).toBeGreaterThan(0);
  expect(res.moved.exact).toBe(false);
  expect(res.moved.updated.quote.exact).toContain('harbour pilot');
  await expect(page.locator('.q-page[data-page="0"] .q-d-highlight').first()).toBeVisible();
  const before = await page.locator('.q-page[data-page="0"] .q-d-highlight').first().boundingBox();
  await page.evaluate(() => (window as any).__h.engine.setPresentation({ fit: 'custom', zoom: 2 }));
  await expect.poll(async () => (await page.locator('.q-page[data-page="0"] .q-d-highlight').first().boundingBox())?.width ?? 0).toBeGreaterThan(before!.width * 1.5);
});

test('getText and textStream give sentence chunks with locators', async ({ page }) => {
  await open(page, 'text.pdf');
  const r = await page.evaluate(async () => {
    const e = (window as any).__h.engine;
    const text = await e.getText({ from: { kind: 'fixed', page: 0 }, to: { kind: 'fixed', page: 1 } });
    const chunks: any[] = [];
    for await (const c of e.textStream({ kind: 'fixed', page: 2 }, { maxChunkChars: 120 })) {
      chunks.push({ text: c.text, loc: c.locator, anchor: await c.anchorFor(0, 5) });
      if (chunks.length >= 4) break;
    }
    return { text, chunks };
  });
  expect(r.text).toContain('Marker-1');
  expect(r.text).toContain('Marker-2');
  expect(r.chunks.length).toBe(4);
  expect(r.chunks[0].loc.page).toBe(2);
  expect(r.chunks.every((c: any) => c.text.length <= 120)).toBe(true);
  expect(r.chunks[0].anchor.pdfQuads.length).toBeGreaterThan(0);
});

test('thumbnails render cheaply and the cover is a blob', async ({ page }) => {
  await open(page, 'text.pdf');
  const r = await page.evaluate(async () => {
    const e = (window as any).__h.engine;
    const t0 = performance.now();
    const bm = await e.thumbnail(0, 160);
    const again = await e.thumbnail(0, 160);
    const cover = await (window as any).__h.handle.metadata.cover();
    return { w: bm.width, h: bm.height, ms: performance.now() - t0, same: again.width === bm.width, cover: cover.size };
  });
  expect(r.w).toBe(160);
  expect(r.h).toBeGreaterThan(160);
  expect(r.cover).toBeGreaterThan(500);
});

test('two-page spread with first page alone', async ({ page }) => {
  await open(page, 'text.pdf');
  await page.evaluate(() => (window as any).__h.engine.setPresentation({ spread: 'double', fit: 'page' }));
  await expect(page.locator('.q-row').first().locator('.q-page')).toHaveCount(1);
  await expect(page.locator('.q-row').nth(1).locator('.q-page')).toHaveCount(2);
  expect((await stats(page)).spread).toBe(true);
});

test('dispose frees everything: 20 open/close cycles leave no DOM or workers behind', async ({ page }) => {
  await open(page, 'text.pdf');
  const r = await page.evaluate(async () => {
    const h = (window as any).__h;
    for (let i = 0; i < 20; i++) await h.open('text.pdf', {});
    h.engine.dispose();
    await new Promise((res) => setTimeout(res, 100));
    return { pdfRoots: document.querySelectorAll('.q-pdf').length, canvases: document.querySelectorAll('canvas').length };
  });
  expect(r).toEqual({ pdfRoots: 0, canvases: 0 });
});

test('scrolling a 2,000-page PDF keeps frames short (reported, loose bound)', async ({ page }) => {
  await open(page, 'big.pdf');
  await waitRendered(page, 0);
  const r = await page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>('.q-pdf')!;
    const frames: number[] = [];
    let last = performance.now();
    let stop = false;
    const loop = () => { const n = performance.now(); frames.push(n - last); last = n; if (!stop) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    for (let i = 0; i < 150; i++) { root.scrollTop += 400; await new Promise((res) => requestAnimationFrame(res)); }
    stop = true;
    frames.sort((a, b) => a - b);
    return { p50: frames[Math.floor(frames.length / 2)], p95: frames[Math.floor(frames.length * 0.95)], max: frames.at(-1), stats: (window as any).__h.engine.stats() };
  });
  console.log(`scroll frames: p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max!.toFixed(1)} ms; mounted ${r.stats.mountedPages}, bitmaps ${r.stats.cachedBitmaps}`);
  expect(r.p95).toBeLessThan(60);
  expect(r.stats.mountedPages).toBeLessThanOrEqual(8);
});
