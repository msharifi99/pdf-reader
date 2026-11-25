import { test, expect, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

/** Open the CBZ and give page 0 three words (two on one line) in image pixels. */
async function openWithOcr(page: Page, opts: Record<string, unknown> = {}) {
  await page.goto('/harness/comic.html');
  await page.evaluate((o) => (window as any).__h.open('comic.cbz', o), opts);
  return page.evaluate(async () => {
    const e = (window as any).__h.engine;
    const { width: W, height: H } = await e.ocrPageSize(0);
    const w = (text: string, x: number, y: number) => ({ text, x: W * x, y: H * y, width: W * 0.22, height: H * 0.05 });
    e.setOcrWords(0, [w('Hello', 0.1, 0.1), w('brave', 0.36, 0.1), w('world', 0.1, 0.3)]);
    (window as any).__sel = [];
    e.on('selection', (s: unknown) => (window as any).__sel.push(s));
    (window as any).__deco = [];
    e.on('decorationclick', (d: unknown) => (window as any).__deco.push(d));
    return { W, H };
  });
}
const selectWords = (page: Page, from: number, to: number) =>
  page.evaluate(([a, b]) => {
    const spans = document.querySelectorAll('.q-view:last-of-type .q-ocr span');
    const r = document.createRange();
    r.setStartBefore(spans[a!]!);
    r.setEndAfter(spans[b!]!);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  }, [from, to]);

test('OCR words become a selectable layer: selection event and anchor carry text, page, y and word boxes', async ({ page }) => {
  const { W, H } = await openWithOcr(page);
  expect(await page.locator('.q-view .q-ocr span').count()).toBe(3);
  await selectWords(page, 0, 1);
  await expect.poll(() => page.evaluate(() => (window as any).__sel.at(-1)?.text)).toBe('Hello brave');
  const sel = await page.evaluate(() => (window as any).__sel.at(-1));
  expect(sel.rects.length).toBeGreaterThan(0);
  expect(sel.anchor.locator).toMatchObject({ kind: 'fixed', page: 0 });
  expect(sel.anchor.locator.y).toBeCloseTo(0.1, 2);
  expect(sel.anchor.quote.exact).toBe('Hello brave');
  expect(sel.anchor.pdfQuads).toHaveLength(1); // two words on one line merge into one box
  expect(sel.anchor.pdfQuads[0][0]).toBeCloseTo(W * 0.1, 0);
  expect(sel.anchor.pdfQuads[0][2]).toBeCloseTo(W * 0.48, 0);
  expect(await page.evaluate(() => (window as any).__h.engine.selectionToAnchor().then((a: any) => a?.quote.exact))).toBe('Hello brave');
  await page.evaluate(() => (window as any).__h.engine.clearSelection());
  expect(await page.evaluate(() => (window as any).__sel.at(-1))).toBeNull();
  expect(H).toBeGreaterThan(0);
});

test('a decoration draws over its word box and a click on it emits decorationclick, not pointer', async ({ page }) => {
  await openWithOcr(page);
  await selectWords(page, 2, 2);
  await expect.poll(() => page.evaluate(() => (window as any).__sel.at(-1)?.text)).toBe('world');
  const anchor = await page.evaluate(() => (window as any).__sel.at(-1).anchor);
  await page.evaluate(() => (window as any).__h.engine.clearSelection());
  await page.evaluate((a) => (window as any).__h.engine.setDecorations('annotations', [{ id: 'h1', anchor: a, style: { type: 'highlight', color: 0 } }]), anchor);
  const deco = page.locator('.q-d[data-deco="h1"]');
  await expect(deco).toHaveCount(1);
  const [d, w] = await Promise.all([deco.boundingBox(), page.locator('.q-ocr span').nth(2).boundingBox()]);
  expect(d!.x).toBeCloseTo(w!.x, 0);
  expect(d!.y).toBeCloseTo(w!.y, 0);
  expect(d!.width).toBeCloseTo(w!.width, 0);
  // ranges follow the same box
  const ranges = await page.evaluate((a) => (window as any).__h.engine.anchorToRanges(a), anchor);
  expect(ranges.regions[0].rects[0].width).toBeCloseTo(w!.width, 0);
  await page.mouse.click(d!.x + d!.width / 2, d!.y + d!.height / 2);
  await expect.poll(() => page.evaluate(() => (window as any).__deco.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__deco[0])).toMatchObject({ layer: 'annotations', id: 'h1' });
  expect(await page.evaluate(() => (window as any).__h.pointers.length)).toBe(0);
  // a click elsewhere is still an ordinary pointer event
  await page.mouse.click(d!.x + d!.width / 2, d!.y + d!.height + 200);
  await expect.poll(() => page.evaluate(() => (window as any).__h.pointers.length)).toBe(1);
});

test('textStream, getText and search yield the OCR text', async ({ page }) => {
  await openWithOcr(page);
  const out = await page.evaluate(async () => {
    const e = (window as any).__h.engine;
    const chunks: string[] = [];
    for await (const c of e.textStream()) chunks.push(c.text);
    const hits: any[] = [];
    for await (const h of e.search('brave')) hits.push(h);
    return { chunks, text: await e.getText({ from: { kind: 'fixed', page: 0 }, to: { kind: 'fixed', page: 3 } }), hits, hasText: (window as any).__h.handle.hasText };
  });
  expect(out.chunks).toEqual(['Hello brave world']);
  expect(out.text).toBe('Hello brave world');
  expect(out.hits).toHaveLength(1);
  expect(out.hits[0].anchor.pdfQuads[0][0]).toBeGreaterThan(0);
  expect(out.hasText).toBe(true);
});

test('rotation turns the page 90 degrees and moves the text layer with it', async ({ page }) => {
  await openWithOcr(page);
  const before = (await page.locator('canvas.q-page').first().boundingBox())!;
  const spanBefore = (await page.locator('.q-ocr span').first().boundingBox())!;
  await page.evaluate(() => (window as any).__h.engine.setPresentation({ rotation: 90 }));
  await expect.poll(async () => ((await page.locator('canvas.q-page').first().boundingBox())!.width > (await page.locator('canvas.q-page').first().boundingBox())!.height) === before.width > before.height).toBe(false);
  const after = (await page.locator('canvas.q-page').first().boundingBox())!;
  expect(after.width / after.height).toBeCloseTo(before.height / before.width, 1);
  // the first word (top-left of the page) is now at the top-right of the rotated page
  const spanAfter = (await page.locator('.q-ocr span').first().boundingBox())!;
  expect(spanAfter.x + spanAfter.width / 2).toBeGreaterThan(after.x + after.width / 2);
  expect(spanAfter.height).toBeGreaterThan(spanBefore.width * 0.5); // box is turned: its old width is now its height
  await page.evaluate(() => (window as any).__h.engine.setPresentation({ rotation: 0 }));
  await expect.poll(async () => { const b = (await page.locator('canvas.q-page').first().boundingBox())!; return Math.round((b.width / b.height) * 100); }).toBe(Math.round((before.width / before.height) * 100));
});

test('two-finger pinch zooms around the midpoint', async ({ page }) => {
  await openWithOcr(page);
  const z0 = (await page.locator('canvas.q-page').first().boundingBox())!.width;
  const c = (await page.locator('.q-comic').boundingBox())!;
  await page.evaluate(([cx, cy]) => {
    const root = document.querySelector('.q-comic')!;
    const fire = (type: string, id: number, x: number) => root.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: cy!, button: 0, bubbles: true, isPrimary: id === 1 }));
    fire('pointerdown', 1, cx! - 40);
    fire('pointerdown', 2, cx! + 40);
    for (let i = 1; i <= 5; i++) {
      fire('pointermove', 1, cx! - 40 - i * 20);
      fire('pointermove', 2, cx! + 40 + i * 20);
    }
    fire('pointerup', 1, cx! - 140);
    fire('pointerup', 2, cx! + 140);
  }, [c.x + c.width / 2, c.y + c.height / 2]);
  await expect.poll(async () => (await page.locator('canvas.q-page').first().boundingBox())!.width).toBeGreaterThan(z0 * 1.5);
});
