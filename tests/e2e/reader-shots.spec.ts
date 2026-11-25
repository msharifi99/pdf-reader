import { type Page } from '@playwright/test';
import { test, expect } from './helpers/test';

// Reader screenshots for design review (T8). Run on demand: SHOTS=1 npx playwright test reader-shots
test.skip(!process.env.SHOTS, 'screenshots only on demand (SHOTS=1)');

const OUT = process.env.SHOTS_DIR ?? 'docs/design';
const THEMES = (process.env.SHOTS_THEMES ?? 'dark,solarized-light,sepia').split(',');
const SIZES = (process.env.SHOTS_SIZES ?? '1280x800,1920x1080').split(',').map((s) => s.split('x').map(Number) as [number, number]);

async function open(page: Page, path: string) {
  await page.evaluate((p) => (globalThis as any).__QUIRE__.openDocument(p), path);
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
  await page.waitForTimeout(700);
}
const close = async (page: Page) => {
  await page.evaluate(() => (globalThis as any).__QUIRE__.closeBook());
  await expect(page.getByTestId('reader-view')).toHaveCount(0);
};
/** keep the chrome up (it fades 2 s after the last input) */
const wake = (page: Page) => page.mouse.move(640 + Math.random() * 20, 400);

for (const theme of THEMES)
  for (const [w, h] of SIZES) {
    test(`reader ${theme} ${w}x${h}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: w, height: h });
      const shot = async (name: string) => {
        await page.waitForTimeout(350);
        await page.screenshot({ path: `${OUT}/reader-${name}-${theme}-${w}x${h}.png` });
      };
      await page.goto('/');
      await page.waitForFunction(() => (globalThis as any).__QUIRE__);
      await page.evaluate((t) => (globalThis as any).__QUIRE__.settings.set('theme', t), theme);

      // EPUB: chrome, focus, contents, typography, find, footnote, ruler
      await open(page, 'reflow/epub3.epub');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(600);
      await wake(page);
      await shot('epub');
      await page.keyboard.press('f');
      await page.waitForTimeout(400);
      await shot('epub-focus');
      await page.keyboard.press('f');
      await page.keyboard.press('t');
      await expect(page.getByTestId('toc')).toBeVisible();
      await shot('epub-toc');
      await page.keyboard.press('Escape');
      await page.getByTestId('reader-typography-button').click();
      await expect(page.getByTestId('typography-panel')).toBeVisible();
      await shot('epub-typography');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+f');
      await page.keyboard.type('the');
      await expect(page.getByTestId('find-count')).toHaveText(/of/, { timeout: 10_000 });
      await page.getByTestId('find-bar').getByRole('button', { name: /results|list/i }).first().click().catch(() => {});
      await shot('epub-find');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('find-bar')).toHaveCount(0);
      // footnote: find the word carrying the note reference, then click the reference
      await page.keyboard.press('Home');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+f');
      await page.getByTestId('find-bar').locator('input').fill('nerves');
      await expect(page.getByTestId('find-count')).toHaveText(/ of /, { timeout: 10_000 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape');
      for (let i = 0; i < 6; i++) {
        const box = await page.evaluate(() => {
          const r = (globalThis as any).__QUIRE_READER__.session.engine.getContents();
          for (const c of r) {
            const a = c.doc.getElementById('r1');
            if (!a) continue;
            const b = a.getBoundingClientRect();
            const f = c.doc.defaultView.frameElement.getBoundingClientRect();
            if (b.left + f.left > 0 && b.left + f.left < innerWidth) return { x: f.left + b.left + b.width / 2, y: f.top + b.top + b.height / 2 };
          }
          return null;
        });
        if (box) {
          await page.mouse.click(box.x, box.y);
          break;
        }
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(500);
      }
      await expect(page.getByTestId('footnote')).toBeVisible();
      await shot('epub-footnote');
      await page.keyboard.press('Escape');
      await page.keyboard.press('r');
      await page.mouse.move(w / 2, h / 2);
      await shot('epub-ruler');
      await page.keyboard.press('r');
      await close(page);

      // PDF: page, thumbnails, view options
      await open(page, 'pdf/text.pdf');
      await wake(page);
      await shot('pdf');
      await page.keyboard.press('Shift+T');
      await expect(page.getByTestId('thumbnails')).toBeVisible();
      await page.waitForTimeout(800);
      await shot('pdf-thumbnails');
      await page.keyboard.press('Escape');
      await page.getByTestId('reader-view-button').click();
      await expect(page.getByTestId('view-options')).toBeVisible();
      await shot('pdf-view-options');
      await page.keyboard.press('Escape');
      await close(page);

      // comic
      await open(page, 'comic/comic.cbz');
      await wake(page);
      await shot('comic');
      await close(page);

      // password
      await page.evaluate(() => (globalThis as any).__QUIRE__.openDocument('pdf/encrypted.pdf'));
      await expect(page.getByTestId('password-dialog')).toBeVisible({ timeout: 15_000 });
      await shot('password');
    });
  }
