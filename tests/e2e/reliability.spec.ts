import { type Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { boot, openDoc, R } from './helpers/reader';

// Reliability (T15): settings shared between windows, restore reloads the keymap, global undo, the delete toast's
// Undo, and progress surviving an abrupt close (stories 36, 114).

const q = (page: Page, fn: string) => page.evaluate(`(async () => { const q = globalThis.__QUIRE__; return await (${fn})(q); })()`);
const hasF6 = `(q) => q.keymap.bindingsFor('app.cheatSheet').some((x) => JSON.stringify(x).includes('F6'))`;

test('theme, typography and keymap changed in one window apply live in the other', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await boot(a);
  await boot(b);
  await q(a, `(q) => { q.settings.set('theme', 'sepia'); q.settings.update('typography', (t) => ({ ...t, fontSize: 27 })); q.keymap.bind('global', 'F6', 'app.cheatSheet'); }`);
  await expect.poll(() => q(b, '(q) => q.settings.value.theme')).toBe('sepia');
  await expect.poll(() => q(b, '(q) => q.settings.value.typography.fontSize')).toBe(27);
  await expect.poll(() => q(b, hasF6)).toBe(true);
  // and back, from the other side
  await q(b, `(q) => q.settings.set('theme', 'dark')`);
  await expect.poll(() => q(a, '(q) => q.settings.value.theme')).toBe('dark');
});

test('restoring a backup reloads settings, including the keymap', async ({ page }) => {
  await boot(page);
  await q(page, `async (q) => { q.keymap.bind('global', 'F6', 'app.cheatSheet'); await q.settings.flush(); }`);
  const diff = await q(page, '(q) => JSON.parse(JSON.stringify(q.keymap.serialize()))');
  await q(page, `async (q) => { q.keymap.resetAll(); await q.settings.flush(); }`);
  expect(await q(page, hasF6)).toBe(false);
  // the backup's settings arrive with the restore
  await page.evaluate(async (d) => {
    const f = (globalThis as any).__QUIRE_FAKE__;
    await f.api.setSetting('keymap', d);
    await f.api.setSetting('theme', 'sepia');
    await f.api.restore('backup.quire');
  }, diff);
  await expect.poll(() => q(page, hasF6)).toBe(true);
  await expect.poll(() => q(page, '(q) => q.settings.value.theme')).toBe('sepia');
});

test.describe('library undo', () => {
  async function seed(page: Page) {
    await page.goto('/');
    await expect(page.getByTestId('library-view')).toBeVisible();
    await page.evaluate(async () => {
      const f = (globalThis as any).__QUIRE_FAKE__;
      await f.resetLibrary();
      f.addFixture('reflow/epub3.epub', { title: 'Dune', needsCover: false, status: 'reading', progress: 0.4, openedMinutesAgo: 600 });
      f.addFixture('pdf/text.pdf', { title: 'Walden', needsCover: false });
      f.emitLibraryChanged([]);
    });
    await expect(page.getByTestId('shelf-heading')).toContainText('· 2');
  }
  const tile = (page: Page, t: string) => page.getByTestId('library-shelf').getByRole('button', { name: new RegExp(`^${t},`) });

  test('Ctrl+Z and Ctrl+Y bring a removed book back and remove it again', async ({ page }) => {
    await seed(page);
    await tile(page, 'Dune').focus();
    await page.keyboard.press('Delete');
    await expect(tile(page, 'Dune')).toHaveCount(0);
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('Control+z');
    await expect(tile(page, 'Dune')).toBeVisible();
    await page.keyboard.press('Control+y');
    await expect(tile(page, 'Dune')).toHaveCount(0);
  });

  test('undoing after the 7 s window restores the book without touching last-read', async ({ page }) => {
    await seed(page);
    const lastOpened = () =>
      page.evaluate(async () => {
        const all = await (globalThis as any).__QUIRE_FAKE__.api.listBooks({});
        return all.find((b: any) => b.title === 'Dune')?.lastOpenedAt ?? null;
      });
    const before = await lastOpened();
    expect(before).not.toBeNull();
    await tile(page, 'Dune').focus();
    await page.keyboard.press('Delete');
    await page.waitForTimeout(7500); // committed in the core
    expect(await lastOpened()).toBeNull(); // hidden: not listed
    await page.keyboard.press('Control+z');
    await expect(tile(page, 'Dune')).toBeVisible();
    expect(await lastOpened()).toBe(before);
  });
});

test('the delete toast Undo restores that bookmark, not the latest change', async ({ page }) => {
  await boot(page);
  await openDoc(page, 'pdf/text.pdf');
  if ((await R(page, '(r) => r.session.flow')) !== 'paginated') await q(page, `(q) => q.commands.execute('reader.toggleFlow')`);
  const items = () => page.evaluate(() => (globalThis as any).__QUIRE_ANNOTATIONS__.store.items.map((a: any) => a.anchor.locator.page as number).sort());
  const pageNo = () => R(page, '(r) => r.session.location.locator.page');
  await page.keyboard.press('Control+b'); // bookmark on page 0
  await expect.poll(items).toEqual([0]);
  await page.keyboard.press('Control+b'); // removed: toast
  await expect.poll(items).toEqual([]);
  await page.keyboard.press('ArrowRight');
  await expect.poll(pageNo).toBe(1);
  await page.keyboard.press('Control+b'); // a later change: bookmark on page 1
  await expect.poll(items).toEqual([1]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(items).toEqual([0, 1]); // page 0's bookmark is back and page 1's stays
});

test('progress written after the debounce survives the window being killed', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await boot(page);
  await openDoc(page, 'pdf/text.pdf');
  await R(page, '(r) => r.session.jump({ kind: "fixed", page: 3, y: 0 })');
  const id = (await R(page, '(r) => r.session.book.id')) as string;
  await page.waitForTimeout(2400); // past the 2 s debounce
  const saved = await page.evaluate((id) => (globalThis as any).__QUIRE_READER__.core.getProgress(id).then((p: any) => p?.locator?.page), id);
  expect(saved).toBe(3);
  await page.close({ runBeforeUnload: false });
  await ctx.close();
});

test('a close request makes the webview write its pending position at once', async ({ page }) => {
  await boot(page);
  await openDoc(page, 'pdf/text.pdf');
  await R(page, '(r) => r.session.jump({ kind: "fixed", page: 2, y: 0 })');
  const id = (await R(page, '(r) => r.session.book.id')) as string;
  const saved = () => page.evaluate((id) => (globalThis as any).__QUIRE_READER__.core.getProgress(id).then((p: any) => p?.locator?.page ?? null), id);
  expect(await saved()).not.toBe(2); // still inside the debounce
  await page.evaluate(() => (globalThis as any).__QUIRE_FAKE__.requestFlush());
  await expect.poll(saved).toBe(2);
});

test.describe('the page-error guard', () => {
  test.use({ allowedPageErrors: [/deliberate/] });
  test('an error a test declares is allowed (any other one fails the test)', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => void setTimeout(() => { throw new Error('deliberate'); }));
    await page.evaluate(() => void Promise.reject(new Error('deliberate rejection')));
    await page.waitForTimeout(100);
  });
});
