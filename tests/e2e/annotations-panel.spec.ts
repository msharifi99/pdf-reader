import { type Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { boot, chapter, close, coreItems, items, open, seed, settled } from './helpers/annotations';

// Bookmarks, the annotations panel, re-anchoring, the library-wide highlights view (T11).

test.beforeEach(async ({ page }) => boot(page));

const pageNo = (page: Page) => page.evaluate(() => (globalThis as any).__QUIRE_READER__.session.location?.locator.page as number);
async function paginate(page: Page) {
  const flow = await page.evaluate(() => (globalThis as any).__QUIRE_READER__.session.flow);
  if (flow !== 'paginated') await page.evaluate(() => (globalThis as any).__QUIRE__.commands.execute('reader.toggleFlow'));
}

test('Ctrl+B bookmarks the page, the ribbon shows, it can be named, and Ctrl+B removes it', async ({ page }) => {
  await open(page, 'pdf/text.pdf');
  await paginate(page);
  await expect(page.getByTestId('bookmark-ribbon')).toHaveCount(0);
  await page.keyboard.press('Control+b');
  await expect(page.getByTestId('bookmark-ribbon')).toBeVisible();
  await expect.poll(() => items(page)).toMatchObject([{ type: 'bookmark', anchor: { locator: { kind: 'fixed', page: 0 } } }]);
  // another page: no ribbon; back: ribbon
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => pageNo(page)).toBe(1);
  await expect(page.getByTestId('bookmark-ribbon')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('bookmark-ribbon')).toBeVisible();
  await page.getByTestId('bookmark-ribbon').click();
  await page.getByTestId('bookmark-name').fill('Where it starts');
  await page.keyboard.press('Enter');
  await expect.poll(() => items(page)).toMatchObject([{ label: 'Where it starts' }]);
  await expect(page.getByTestId('bookmark-ribbon')).toHaveAttribute('aria-label', 'Bookmark: Where it starts');
  await page.keyboard.press('Control+b');
  await expect(page.getByTestId('bookmark-ribbon')).toHaveCount(0);
  await expect.poll(() => items(page)).toHaveLength(0);
});

test('EPUB: Ctrl+B bookmarks the position', async ({ page }) => {
  await open(page, 'reflow/epub3.epub');
  await chapter(page, 2);
  await page.keyboard.press('Control+b');
  await expect(page.getByTestId('bookmark-ribbon')).toBeVisible();
  await expect.poll(() => items(page)).toMatchObject([{ type: 'bookmark', anchor: { locator: { kind: 'reflow' } } }]);
});

test('the panel lists annotations in position order, filters, searches, edits and jumps', async ({ page }) => {
  await seed(page, 'pdf/text.pdf', [
    { type: 'highlight', color: 'pink', page: 4, exact: 'Marker-5' },
    { type: 'note', color: 'blue', page: 2, exact: 'Marker-3', note: 'The third one.' },
    { type: 'highlight', color: 'yellow', page: 0, exact: 'Marker-1' },
    { type: 'bookmark', page: 1, label: 'Page two' },
  ]);
  await open(page, 'pdf/text.pdf');
  await paginate(page);
  await page.keyboard.press('a');
  const panel = page.getByTestId('annotations-panel');
  await expect(panel).toBeVisible();
  const rows = panel.getByTestId('annotation-item');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Marker-1');
  await expect(rows.nth(1)).toContainText('Page two');
  await expect(rows.nth(2)).toContainText('Marker-3');
  await expect(rows.nth(2)).toContainText('The third one.');
  await expect(rows.nth(3)).toContainText('Marker-5');

  await panel.getByRole('button', { name: /^Notes/ }).click();
  await expect(rows).toHaveCount(1);
  await panel.getByRole('button', { name: /^Notes/ }).click();
  await panel.getByRole('button', { name: 'Only pink' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Marker-5');
  await panel.getByRole('button', { name: 'Only pink' }).click();
  await panel.getByRole('searchbox').or(panel.locator('input')).first().fill('third');
  await expect(rows).toHaveCount(1);
  await panel.locator('input').first().fill('');
  await expect(rows).toHaveCount(4);

  // click jumps; keyboard moves and recolours
  await rows.nth(3).locator('.entry').click();
  await expect.poll(() => pageNo(page)).toBe(4);
  await rows.nth(0).locator('.entry').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(2).locator('.entry')).toBeFocused();
  await page.keyboard.press('4');
  await expect.poll(async () => (await items(page))[2]?.color).toBe('pink');
  await page.keyboard.press('Enter');
  await expect.poll(() => pageNo(page)).toBe(2);

  // inline note edit
  await rows.nth(0).locator('.entry').focus();
  await page.keyboard.press('n');
  await page.getByTestId('note-editor').fill('First marker');
  await page.keyboard.press('Control+Enter');
  await expect(rows.nth(0)).toContainText('First marker');
  await expect.poll(async () => (await items(page))[0]).toMatchObject({ type: 'note', note: 'First marker' });
});

test('re-anchoring: a quote that moved is found again and repaired; a lost one stays, orphaned', async ({ page }) => {
  const id = await seed(page, 'pdf/text.pdf', [
    { type: 'highlight', color: 'green', page: 0, exact: 'Marker-5' }, // really on page 5 (index 4)
    { type: 'note', color: 'yellow', page: 1, exact: 'A sentence that is in no page of this file', note: 'Keep me' },
  ]);
  await open(page, 'pdf/text.pdf');
  await expect.poll(async () => (await coreItems(page, id)).find((a) => a.anchor.quote.exact === 'Marker-5')?.anchor.locator.page, { timeout: 15_000 }).toBe(4);
  const moved = (await coreItems(page, id)).find((a) => a.anchor.quote.exact === 'Marker-5')!;
  expect(moved.anchor.pdfQuads?.length).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => [...(globalThis as any).__QUIRE_ANNOTATIONS__.store.orphans].length)).toBe(1);
  await page.keyboard.press('a');
  const lost = page.getByTestId('annotation-item').filter({ hasText: 'Keep me' });
  await expect(lost).toContainText('Passage not found');
  expect(await coreItems(page, id)).toHaveLength(2);
});

test('library highlights view: searches across books and opens at the highlight', async ({ page }) => {
  await seed(page, 'pdf/text.pdf', [
    { type: 'highlight', color: 'green', page: 4, exact: 'Marker-5' },
    { type: 'note', color: 'blue', page: 0, exact: 'Marker-1', note: 'beginning' },
  ]);
  await open(page, 'reflow/epub3.epub');
  await chapter(page, 0);
  await page.evaluate(() => {
    const r = (globalThis as any).__QUIRE_READER__;
    const l = r.session.location.locator;
    return r.core.createAnnotation({ bookId: r.session.book.id, type: 'highlight', color: 'pink', anchor: { locator: l, quote: { exact: 'It is a truth universally acknowledged', prefix: '', suffix: '' } }, note: null, label: null });
  });
  await close(page);
  await page.getByTestId('library-highlights').click();
  const view = page.getByTestId('highlights-view');
  await expect(view).toBeVisible();
  await expect(view.getByTestId('highlights-book')).toHaveCount(2);
  await expect(view.getByTestId('highlights-item')).toHaveCount(3);
  await view.locator('input').first().fill('marker');
  await expect(view.getByTestId('highlights-item')).toHaveCount(2);
  await view.locator('input').first().fill('beginning');
  await expect(view.getByTestId('highlights-item')).toHaveCount(1);
  await view.locator('input').first().fill('Marker-5');
  await expect(view.getByTestId('highlights-item')).toHaveCount(1);
  await expect(view.getByTestId('highlights-item')).toContainText('Marker-5');
  await view.getByTestId('highlights-item').click();
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
  await expect.poll(() => pageNo(page)).toBe(4);
  // Esc in the library view goes back to the shelves; the palette command reaches it too
  await close(page);
  await page.evaluate(() => (globalThis as any).__QUIRE__.commands.execute('annotate.allHighlights'));
  await expect(page.getByTestId('highlights-view')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('highlights-view')).toHaveCount(0);
  await settled(page).catch(() => {});
});
