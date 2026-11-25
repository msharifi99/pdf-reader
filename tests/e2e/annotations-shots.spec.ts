import { test, expect, type Page } from '@playwright/test';
import { boot, chapter, close, items, open, seed, selectEpub, selectPdf } from './annotations-helpers';

// Annotation screenshots for design review (T11). Run on demand: SHOTS=1 npx playwright test annotations-shots
test.skip(!process.env.SHOTS, 'screenshots only on demand (SHOTS=1)');

const OUT = process.env.SHOTS_DIR ?? 'docs/design';
const THEMES = (process.env.SHOTS_THEMES ?? 'dark,solarized-light,sepia').split(',');
const wake = (page: Page) => page.mouse.move(600 + Math.random() * 20, 420);

for (const theme of THEMES)
  test(`annotations ${theme}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const shot = async (name: string) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/annotations-${name}-${theme}.png` });
    };
    await boot(page);
    await page.evaluate((t) => (globalThis as any).__QUIRE__.settings.set('theme', t), theme);

    // EPUB: the menu, then all four colours, one with a note
    await open(page, 'reflow/epub3.epub');
    await chapter(page, 0);
    const lines = ['It is a truth universally acknowledged', 'must be in want of a wife', 'However little known the feelings', 'considered the rightful property'];
    for (const [i, l] of lines.entries()) {
      await selectEpub(page, l).catch(() => {});
      if (i === 0) {
        await wake(page);
        await shot('menu');
      }
      await page.keyboard.press(String(i + 1));
    }
    await page.evaluate(() => {
      const a = (globalThis as any).__QUIRE_ANNOTATIONS__;
      const h = a.store.items.find((x: any) => x.color === 'blue');
      if (h) a.setNote(h.id, 'Austen saying the quiet part: the neighbourhood decides before he does.');
    });
    await page.waitForTimeout(300);
    await shot('colors-epub');
    await page.keyboard.press('a');
    await expect(page.getByTestId('annotations-panel')).toBeVisible();
    await shot('panel');
    await page.getByTestId('annotations-panel').getByRole('button', { name: 'Only green' }).click();
    await shot('panel-filter');
    await close(page);

    // PDF: highlights, popover, note editor, bookmark ribbon
    await open(page, 'pdf/text.pdf');
    for (const [i, l] of ['harbour pilot climbed the spiral stair', 'cold iron rail', 'counting the steps', 'colour of slate'].entries()) {
      await selectPdf(page, l).catch(() => {});
      await page.keyboard.press(String(i + 1));
    }
    await expect.poll(async () => (await items(page)).length).toBeGreaterThan(2);
    await page.waitForTimeout(300);
    await shot('colors-pdf');
    const box = await page.locator('[data-layer="annotations"]').nth(1).boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.getByTestId('highlight-popover')).toBeVisible();
      await shot('popover');
      await page.keyboard.press('n');
      await page.keyboard.type('Every evening, the same climb. ');
      await shot('note-editor');
      await page.keyboard.press('Control+Enter');
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('Control+b');
    await wake(page);
    await expect(page.getByTestId('bookmark-ribbon')).toBeVisible();
    await shot('bookmark');
    await close(page);

    // library-wide view
    await seed(page, 'reflow/epub2.epub', []);
    await page.getByTestId('library-highlights').click();
    await expect(page.getByTestId('highlights-view')).toBeVisible();
    await shot('library');
    await page.keyboard.press('Escape');
    // reset for the next theme
    await page.evaluate(async () => {
      const c = (globalThis as any).__QUIRE_LIBRARY__.core;
      for (const r of await c.listAllAnnotations(null)) await c.deleteAnnotation(r.annotation.id);
    });
  });
