import { type Page } from '@playwright/test';
import { test, expect } from './helpers/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Opts = Record<string, unknown>;

test.beforeEach(async ({ page }) => {
  // No cross-fade overlap: exactly one .q-view while a spread is shown.
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function open(page: Page, file: string | object, opts: Opts = {}) {
  await page.goto('/harness/comic.html');
  return page.evaluate(([f, o]) => (window as any).__h.open(f, o), [file, opts] as const);
}
const shown = (page: Page): Promise<number[]> =>
  page.evaluate(() => {
    const views = [...document.querySelectorAll('.q-view')];
    return [...(views.at(-1)?.querySelectorAll<HTMLElement>('.q-page') ?? [])].map((c) => Number(c.dataset.page));
  });
const next = (page: Page) => page.evaluate(() => (window as any).__h.engine.next());
const prev = (page: Page) => page.evaluate(() => (window as any).__h.engine.prev());
const loc = (page: Page) => page.evaluate(() => (window as any).__h.engine.getLocation());
const handle = (page: Page) => page.evaluate(() => (window as any).__h.handle);
const settle = (page: Page, cachedPages: number) =>
  expect.poll(() => page.evaluate(() => (window as any).__h.engine.stats().cachedPages)).toBeGreaterThanOrEqual(cachedPages);

test('CBZ opens on page 1 with ComicInfo metadata, junk ignored, natural order', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  expect(await open(page, 'comic.cbz')).toBeNull();
  expect(await shown(page)).toEqual([0]);
  const h = await handle(page);
  expect(h.pageCount).toBe(10);
  expect(h.hasText).toBe(false);
  expect(h.layout).toBe('fixed');
  expect(h.metadata).toMatchObject({ title: 'Quire Test Comic', authors: ['A. Author'], series: { name: 'Quire Tales', index: 1 } });
  expect(h.toc.map((t: any) => t.title)).toEqual(['Start', 'Chapter Two', 'Chapter Three']);
  expect((await loc(page)).progress.page).toMatchObject({ index: 0, count: 10 });
  // page6.png (the double-width spread) must sit at index 5: page1, page2, ..., page10, not page1, page10, page2.
  await page.evaluate(() => (window as any).__h.engine.goTo({ kind: 'fixed', page: 5 }));
  const box = await page.locator('.q-page[data-page="5"]').boundingBox();
  expect(box!.width).toBeGreaterThan(box!.height);
  expect((await loc(page)).progress.chapter.title).toBe('Chapter Two');
  expect(errors).toEqual([]);
});

test('next/prev turn pages and stop at the ends', async ({ page }) => {
  await open(page, 'comic.cbz');
  expect(await prev(page)).toBe(false);
  expect(await next(page)).toBe(true);
  expect(await shown(page)).toEqual([1]);
  expect((await loc(page)).reason).toBe('page-turn');
  expect(await prev(page)).toBe(true);
  expect(await shown(page)).toEqual([0]);
  await page.evaluate(() => (window as any).__h.engine.goTo({ kind: 'fixed', page: 9 }));
  expect(await next(page)).toBe(false);
  await page.evaluate(() => (window as any).__h.engine.goToFraction(0.5));
  expect((await loc(page)).locator.page).toBe(5);
});

test('double mode: cover alone, pairs, the spread page alone, re-pair after it', async ({ page }) => {
  await open(page, 'comic.cbz', { spread: 'double' });
  const seen = [await shown(page)];
  while (await next(page)) seen.push(await shown(page));
  expect(seen).toEqual([[0], [1, 2], [3, 4], [5], [6, 7], [8, 9]]);
  // and back again
  const back = [];
  while (await prev(page)) back.push(await shown(page));
  expect(back).toEqual([[8, 9], [6, 7], [5], [3, 4], [1, 2], [0]].slice(1));
  // progress reports the left page of a spread
  await page.evaluate(() => (window as any).__h.engine.goTo({ kind: 'fixed', page: 4 }));
  expect(await shown(page)).toEqual([3, 4]);
  expect((await loc(page)).locator.page).toBe(3);
});

test('RTL: metadata flips direction, comic.left goes forward, pairs draw right to left', async ({ page }) => {
  await open(page, 'manga-rtl.cbz', { spread: 'double' });
  expect((await handle(page)).metadata.direction).toBe('rtl');
  expect(await page.evaluate(() => (window as any).__h.engine.direction)).toBe('rtl');
  await page.evaluate(() => (window as any).__h.engine.turnToward('left'));
  expect(await shown(page)).toEqual([1, 2]);
  const x = (n: number) => page.locator(`.q-page[data-page="${n}"]`).evaluate((e) => e.getBoundingClientRect().left);
  expect(await x(1)).toBeGreaterThan(await x(2));
  await page.evaluate(() => (window as any).__h.engine.turnToward('right'));
  expect(await shown(page)).toEqual([0]);

  // LTR comic: right goes forward. An explicit direction wins over the file hint.
  await open(page, 'comic.cbz');
  await page.evaluate(() => (window as any).__h.engine.turnToward('right'));
  expect(await shown(page)).toEqual([1]);
  await open(page, 'manga-rtl.cbz', { direction: 'ltr' });
  await page.evaluate(() => (window as any).__h.engine.turnToward('right'));
  expect(await shown(page)).toEqual([1]);
});

test('webtoon virtualises a long strip and scrolling updates the locator', async ({ page }) => {
  const urls = Array.from({ length: 300 }, () => '/fixtures/comic/images/01.png');
  const names = urls.map((_, i) => `p${String(i + 1).padStart(3, '0')}.png`);
  expect(await open(page, { kind: 'images', format: 'image', urls, names }, { flow: 'scrolled', gap: 0 })).toBeNull();
  const realized = () => page.evaluate(() => document.querySelectorAll('.q-webtoon .q-page').length);
  expect(await realized()).toBeLessThan(15);
  expect(await realized()).toBeGreaterThan(0);

  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.q-webtoon')!;
    el.scrollTop = el.scrollHeight / 2;
  });
  await expect.poll(async () => (await loc(page)).locator.page).toBeGreaterThan(120);
  const l = await loc(page);
  expect(l.locator.page).toBeLessThan(180);
  expect(l.locator.y).toBeGreaterThanOrEqual(0);
  expect(l.locator.y).toBeLessThanOrEqual(1);
  expect(l.reason).toBe('scroll');
  expect(await realized()).toBeLessThan(15);
  expect(l.progress.fraction).toBeCloseTo(0.5, 1);

  await page.evaluate(() => (window as any).__h.engine.goTo({ kind: 'fixed', page: 250, y: 0.5 }));
  await expect.poll(async () => (await loc(page)).locator.page).toBe(250);
  expect((await loc(page)).locator.y).toBeCloseTo(0.5, 1);
  await expect(page.locator('.q-webtoon .q-page[data-page="250"][data-rendered="true"]')).toBeVisible();
  expect(await realized()).toBeLessThan(15);
});

test('webtoon on a real archive keeps its place while page sizes resolve', async ({ page }) => {
  await open(page, 'comic.cbz', { flow: 'scrolled', page: 3, y: 0.25 });
  await expect(page.locator('.q-webtoon .q-page[data-page="3"][data-rendered="true"]')).toBeVisible();
  await settle(page, 3);
  const l = await loc(page);
  expect(l.locator.page).toBe(3);
  expect(l.locator.y).toBeCloseTo(0.25, 1);
  expect(await next(page)).toBe(true);
});

test('CBR opens: RAR5 and RAR4', async ({ page }) => {
  for (const file of ['comic.cbr', 'comic-rar4.cbr']) {
    expect(await open(page, file)).toBeNull();
    const h = await handle(page);
    expect(h.pageCount, file).toBe(5);
    expect(h.metadata.title, file).toBe('Quire Test Comic');
    await expect(page.locator('.q-page[data-page="0"]')).toBeVisible();
    expect(await next(page)).toBe(true);
    expect(await shown(page)).toEqual([1]);
    await page.evaluate(() => (window as any).__h.engine.goTo({ kind: 'fixed', page: 3 }));
    const box = await page.locator('.q-page[data-page="3"]').boundingBox();
    expect(box!.width, `${file} spread page`).toBeGreaterThan(box!.height);
  }
});

test('a password-protected RAR gives a calm typed error (libarchive cannot decrypt RAR5)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const err = await open(page, 'encrypted.cbr', { password: 'quire' });
  expect(err.code).toBe('unsupported-format');
  expect(err.message).toMatch(/password/i);
  expect(errors).toEqual([]);
});

test('an image folder opens at the chosen start image, in natural order', async ({ page }) => {
  await page.goto('/harness/comic.html');
  const err = await page.evaluate(() => (window as any).__h.openFolder('comic/images', 'comic/images/03.webp'));
  expect(err).toBeNull();
  const h = await handle(page);
  expect(h.pageCount).toBe(5); // 01, 02, 03, 04.svg, 10; notes.txt ignored
  expect(await shown(page)).toEqual([2]);
  expect((await loc(page)).locator.page).toBe(2);
  await next(page);
  expect(await shown(page)).toEqual([3]); // the SVG
  await expect(page.locator('.q-page[data-page="3"]')).toBeVisible();
  await next(page);
  expect(await shown(page)).toEqual([4]); // 10.png after 04, not between 01 and 02
  expect(await page.evaluate(() => (window as any).__h.warnings)).toEqual([]);

  // a single image opens its folder
  await page.evaluate(() => (window as any).__h.openFolder('comic/images/02.jpg', 'comic/images/02.jpg'));
  expect((await handle(page)).pageCount).toBe(5);
  expect(await shown(page)).toEqual([1]);
});

test('corrupt, empty and unreadable archives give typed errors, never crashes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  expect((await open(page, 'corrupt.cbz'))?.code).toBe('corrupt');
  expect((await open(page, 'empty.cbz'))?.code).toBe('unsupported-format');
  const missing = await page.evaluate(() => (window as any).__h.open('nope.cbz'));
  expect(['network', 'corrupt', 'unsupported-format']).toContain(missing.code);
  // a corrupt page inside a good book becomes a placeholder plus a warning
  const bad = await page.evaluate(() =>
    (window as any).__h.open({ kind: 'images', format: 'image', urls: ['/fixtures/comic/images/notes.txt', '/fixtures/comic/images/01.png'], names: ['a.png', 'b.png'] }),
  );
  expect(bad).toBeNull();
  await expect.poll(() => page.evaluate(() => (window as any).__h.warnings.length)).toBeGreaterThan(0);
  expect(await shown(page)).toEqual([0]);
  expect(errors).toEqual([]);
});

test('a preloaded page turn takes under 50 ms', async ({ page }) => {
  await open(page, 'comic.cbz');
  await settle(page, 4); // current page + next three
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    times.push(await page.evaluate(() => (window as any).__h.timeTurn('next')));
    await settle(page, 4);
  }
  console.log('page turn ms', times.map((t) => t.toFixed(1)).join(', '));
  for (const t of times) expect(t).toBeLessThan(50);
  expect((await page.evaluate(() => (window as any).__h.engine.stats())).cachedPages).toBeGreaterThanOrEqual(5);
});

test('page tint: invert and smart change the pixels, original does not', async ({ page }) => {
  await open(page, 'comic.cbz', { tint: 'original', theme: 'dark' });
  const sample = () => page.evaluate(() => (window as any).__h.sample() as number[]);
  const orig = await sample();
  expect(orig[0]).toBeGreaterThan(150); // light paper
  await page.evaluate(() => (window as any).__h.engine.setPresentation({ pageTint: 'invert' }));
  const inv = await sample();
  expect(inv[0]).toBeLessThan(orig[0]! - 60);
  await page.evaluate(() => (window as any).__h.engine.setPresentation({ pageTint: 'smart' }));
  const smart = await sample();
  expect(smart[0]).toBeLessThan(orig[0]! - 40); // paper becomes the dark theme background
  await page.evaluate(() => (window as any).__h.engine.setPresentation({ pageTint: 'original' }));
  const again = await sample();
  for (const i of [0, 1, 2]) expect(Math.abs(again[i]! - orig[i]!)).toBeLessThan(3); // same pixels up to resampling
});

test('ctrl+wheel zooms around the cursor; clicks report a zone', async ({ page }) => {
  await open(page, 'comic.cbz');
  const vp = page.viewportSize()!;
  await page.mouse.click(vp.width - 10, vp.height / 2);
  await page.mouse.click(10, vp.height / 2);
  const pointers = await page.evaluate(() => (window as any).__h.pointers);
  expect(pointers.map((p: any) => p.zone)).toEqual(['right', 'left']);

  const before = await page.locator('.q-page[data-page="0"]').boundingBox();
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -400);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await page.locator('.q-page[data-page="0"]').boundingBox())!.width).toBeGreaterThan(before!.width * 1.4);
  const pres = await page.evaluate(() => (window as any).__h.presentation);
  expect(pres.some((p: any) => p.fit === 'custom')).toBe(true);
  expect(await page.evaluate(() => (window as any).__h.engine.getPresentation().fit)).toBe('custom');
});

test('thumbnails, cover and dispose', async ({ page }) => {
  await open(page, 'comic.cbz');
  const t = await page.evaluate(async () => {
    const e = (window as any).__h.engine;
    const bm = await e.thumbnail(2, 120);
    const cover: Blob = await (window as any).__h.handle.metadata.cover();
    return { w: bm.width, h: bm.height, coverType: cover.type, coverSize: cover.size };
  });
  expect(t.w).toBe(120);
  expect(t.h).toBeGreaterThan(120);
  expect(t.coverType).toBe('image/webp');
  expect(t.coverSize).toBeGreaterThan(100);
  await page.evaluate(() => (window as any).__h.engine.dispose());
  expect(await page.locator('.q-comic').count()).toBe(0);
});
