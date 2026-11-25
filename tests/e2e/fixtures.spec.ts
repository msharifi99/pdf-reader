import { test, expect } from './helpers/test';
import { boot } from './helpers/reader';

// SPEC "Testing Decisions": the committed corpus is complete, and every corrupt file ends in a calm error
// dialog (never a crash, never an uncaught page error: the shared `test` fails on those).

const REQUIRED: Record<string, string[]> = {
  'text PDF': ['pdf/text.pdf'],
  'scanned PDF': ['pdf/scanned.pdf'],
  'encrypted PDF': ['pdf/encrypted.pdf'],
  '2,000-page PDF': ['pdf/big.pdf'],
  'EPUB 2 and 3 (footnotes, embedded fonts)': ['reflow/epub2.epub', 'reflow/epub3.epub'],
  MOBI: ['reflow/mobi.mobi'],
  AZW3: ['reflow/azw3.azw3'],
  FB2: ['reflow/fb2.fb2', 'reflow/fb2.fbz'],
  'CBZ, CBR and an RTL manga': ['comic/comic.cbz', 'comic/comic.cbr', 'comic/manga-rtl.cbz'],
  'a folder of images': ['comic/images/index.json', 'comic/images/01.png'],
  'a corrupt file for each format': [
    'pdf/corrupt.pdf', 'reflow/corrupt.epub', 'reflow/corrupt.mobi', 'reflow/corrupt.azw3', 'reflow/corrupt.fb2',
    'reflow/corrupt.fbz', 'comic/corrupt.cbz', 'comic/corrupt.cbr', 'comic/corrupt-image.png',
  ],
};

test('the fixture corpus is complete', async ({ request }) => {
  for (const [what, files] of Object.entries(REQUIRED))
    for (const f of files) {
      const r = await request.get(`/fixtures/${f}`);
      expect(r.status(), `${what}: ${f}`).toBe(200);
      expect((await r.body()).length, `${what}: ${f} is empty`).toBeGreaterThan(10);
    }
});

for (const f of REQUIRED['a corrupt file for each format']!) {
  test(`${f} opens to a calm error and the app carries on`, async ({ page }) => {
    await boot(page);
    await page.evaluate((p) => void (globalThis as any).__QUIRE__.openDocument(p), f);
    await expect(page.getByTestId('error-message')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByTestId('error-message')).toBeHidden();
    await expect.poll(() => page.evaluate(() => (globalThis as any).__QUIRE__.app.view)).toBe('library');
  });
}

const titles = (page: import('@playwright/test').Page) =>
  page.evaluate(async () => (await (globalThis as any).__QUIRE_FAKE__.api.listBooks({})).map((b: any) => b.title as string));

test('a book that fails to open on first add leaves no ghost in the library', async ({ page }) => {
  await boot(page);
  expect(await titles(page)).not.toContain('corrupt');
  await page.evaluate(() => void (globalThis as any).__QUIRE__.openDocument('reflow/corrupt.epub'));
  await expect(page.getByTestId('error-message')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(() => titles(page)).not.toContain('corrupt');
});

test('a missing file says it cannot be found, not that it is damaged', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => void (globalThis as any).__QUIRE__.openDocument('pdf/not-here.pdf'));
  await expect(page.getByText('Quire can’t find this file')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('looks damaged')).toHaveCount(0);
});

test('an existing book that fails to open stays in the library', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const f = (globalThis as any).__QUIRE_FAKE__;
    f.addFixture('reflow/corrupt.epub', { title: 'Keeper' });
  });
  await page.evaluate(() => void (globalThis as any).__QUIRE__.openDocument('reflow/corrupt.epub'));
  await expect(page.getByTestId('error-message')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  expect(await titles(page)).toContain('Keeper');
});

test('the EPUB cover shows alone and centred in a spread', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 800 });
  await boot(page);
  await page.evaluate(() => (globalThis as any).__QUIRE__.openDocument('reflow/epub3.epub'));
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
  await expect(async () => {
    const m = await page.evaluate(() => {
      const e = (globalThis as any).__QUIRE_READER__.session.engine;
      const c = e.getContents()[0];
      const img = c?.doc.querySelector('img') as HTMLImageElement | null;
      if (!img) return null;
      const fr = (c.doc.defaultView!.frameElement as HTMLElement).getBoundingClientRect();
      const r = img.getBoundingClientRect();
      const page0 = (globalThis as any).__QUIRE_READER__.session.location.locator.cfi;
      return { centre: fr.left + r.left + r.width / 2, win: innerWidth, wide: r.width, page0 };
    });
    expect(m).not.toBeNull();
    // the picture's centre sits near the window's centre (not in the left half)
    expect(Math.abs(m!.centre - m!.win / 2)).toBeLessThan(m!.win * 0.15);
  }).toPass({ timeout: 8000 });
});
