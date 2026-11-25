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
