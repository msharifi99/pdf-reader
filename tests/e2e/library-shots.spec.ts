import { test, expect, type Page } from '@playwright/test';

// Library screenshots for design review (T7). Run on demand: SHOTS=1 npx playwright test library-shots
test.skip(!process.env.SHOTS, 'screenshots only on demand (SHOTS=1)');

const OUT = process.env.SHOTS_DIR ?? 'docs/design';
const THEMES = (process.env.SHOTS_THEMES ?? 'dark,solarized-light,sepia').split(',');
const SIZES = (process.env.SHOTS_SIZES ?? '1280x800,1920x1080').split(',').map((s) => s.split('x').map(Number) as [number, number]);

async function boot(page: Page, theme: string, query = '') {
  await page.goto(`/${query}`);
  await expect(page.getByTestId('library-view')).toBeVisible();
  await page.evaluate((t) => (globalThis as any).__QUIRE__.settings.set('theme', t), theme);
  await page.evaluate(() => (globalThis as any).__QUIRE__.settings.set('library', { view: 'grid', sort: 'recent', reverse: false }));
  await page.waitForTimeout(400);
}
const settle = (page: Page) => page.evaluate(() => Promise.all([...document.images].filter((i) => i.getBoundingClientRect().top < innerHeight).map((i) => i.decode().catch(() => {})))).then(() => page.waitForTimeout(350));

for (const theme of THEMES)
  for (const [w, h] of SIZES) {
    test(`library ${theme} ${w}x${h}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: w, height: h });
      const shot = async (name: string) => {
        await settle(page);
        await page.screenshot({ path: `${OUT}/library-${name}-${theme}-${w}x${h}.png` });
      };
      await boot(page, theme);
      await expect(page.getByTestId('continue-reading')).toBeVisible();
      await page.waitForTimeout(2500); // background covers for the real fixtures
      await shot('grid');
      await page.getByTestId('library-view').evaluate((el) => (el.scrollTop = 520));
      await shot('grid-scrolled');
      await page.getByTestId('library-view').evaluate((el) => (el.scrollTop = 0));
      await page.getByRole('radio', { name: 'Compact list' }).click();
      await shot('list');
      await page.getByRole('radio', { name: 'Cover grid' }).click();
      // filtered: reading + a collection
      await page.getByTestId('filter-button').click();
      await page.getByRole('menuitemcheckbox', { name: 'Reading' }).click();
      await page.getByTestId('collections').getByRole('button', { name: /Favourites/ }).click();
      await shot('filtered');
      await page.getByTestId('collections').getByRole('button', { name: 'All', exact: true }).click();
      await page.getByTestId('filter-button').click();
      await page.getByRole('menuitem', { name: 'Clear filters' }).click();
      // context menu
      const tile = page.getByTestId('book').nth(2);
      await tile.click({ button: 'right' });
      await expect(page.locator(':popover-open [role=menu]')).toBeVisible();
      await shot('context-menu');
      await page.keyboard.press('Escape');
      // edit dialog
      await page.getByTestId('book').first().focus();
      await page.keyboard.press('F2');
      await expect(page.getByTestId('edit-book')).toBeVisible();
      await shot('edit-dialog');
      await page.keyboard.press('Escape');
      // search with full-text results
      await page.evaluate(async () => {
        const { core, lib } = (globalThis as any).__QUIRE_LIBRARY__;
        const books = lib.books as { id: string; title: string }[];
        const by = (t: string) => books.find((b) => b.title === t)!.id;
        const put = (id: string, texts: string[]) => core.indexBookChunks(id, texts.map((text, i) => ({ locator: { kind: 'reflow', cfi: '', fraction: i / 10 }, text })), true, true);
        await put(by('Moby-Dick'), ['Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, I thought I would sail about a little and see the watery part of the world.', 'Whenever it is a damp, drizzly November in my soul, and the darkness of the sea comes on, I account it high time to get to sea as soon as I can.']);
        await put(by('Walden'), ['I went to the woods because I wished to live deliberately, to front only the essential facts of life; and when darkness came down over the pond I listened to the owls.']);
        await put(by('The Left Hand of Darkness'), ['I’ll make my report as if I told a story, for I was taught as a child on my homeworld that Truth is a matter of the imagination.', 'Light is the left hand of darkness, and darkness the right hand of light. Two are one, life and death, lying together.']);
      });
      await page.getByRole('searchbox').fill('darkness');
      await expect(page.getByTestId('found-in-books')).toBeVisible();
      await shot('search');
      await page.getByRole('searchbox').fill('');
      // settings: library + data
      for (const f of [String.raw`C:\Users\Reader\Books`, String.raw`D:\Comics`]) await page.evaluate((p) => (globalThis as any).__QUIRE_LIBRARY__.core.addWatchedFolder(p), f);
      await page.keyboard.press('Control+,');
      await page.locator('[data-section="library"]').click();
      await shot('settings-library');
      await page.locator('[data-section="data"]').click();
      await page.evaluate((p) => ((globalThis as any).__QUIRE_PICK__ = [p]), String.raw`C:\Users\Reader\Documents\Quire 2026-11-25.quire-backup`);
      await page.getByRole('button', { name: 'Back up…' }).click();
      await expect(page.getByText(/Saved “Quire/)).toBeVisible();
      await shot('settings-data');
      // empty library
      await boot(page, theme, '?empty');
      await expect(page.getByText('Your shelves are empty')).toBeVisible();
      await shot('empty');
    });
  }
