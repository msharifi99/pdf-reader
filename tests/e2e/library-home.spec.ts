import { test, expect, type Page } from '@playwright/test';

// Library home (T7). Each test seeds a known library through the fake core (no dependence on manifest.json).

const E = 'reflow/epub3.epub', P = 'pdf/text.pdf', C = 'comic/comic.cbz';
const BOOKS: [string, Record<string, unknown>][] = [
  ['reflow/epub3.epub', { title: 'Two Openings', author: 'Austen & Melville', status: 'reading', progress: 0.18, openedMinutesAgo: 9000, collections: ['Fiction'] }],
  ['pdf/text.pdf', { title: 'On Margins and Measure', author: 'Quire Press' }],
  ['comic/comic.cbz', { title: 'Panels at Dusk', author: 'Quire Comics', collections: ['Comics'] }],
  ['s/left-hand.epub', { file: E, title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', status: 'reading', progress: 0.42, openedMinutesAgo: 40, wordCount: 96000, collections: ['Fiction'] }],
  ['s/meditations.epub', { file: E, title: 'Meditations', author: 'Marcus Aurelius', status: 'reading', progress: 0.51, openedMinutesAgo: 1500 }],
  ['s/thinking.pdf', { file: P, title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', status: 'reading', progress: 0.08, openedMinutesAgo: 3000 }],
  ['s/middlemarch.epub', { file: E, title: 'Middlemarch', author: 'George Eliot', status: 'finished', progress: 1, openedMinutesAgo: 30000 }],
  ['s/moby.epub', { file: E, title: 'Moby-Dick', author: 'Herman Melville', status: 'reading', progress: 0.12, openedMinutesAgo: 13000 }],
  ['s/dune.epub', { file: E, title: 'Dune', author: 'Frank Herbert', status: 'finished', progress: 1, openedMinutesAgo: 90000 }],
  ['s/maus.cbz', { file: C, title: 'Maus', author: 'Art Spiegelman', status: 'finished', progress: 1, openedMinutesAgo: 120000, collections: ['Comics'] }],
  ['s/akira.cbz', { file: C, title: 'Akira, Vol. 1', author: 'Katsuhiro Otomo', status: 'reading', progress: 0.9, openedMinutesAgo: 10000, collections: ['Comics'] }],
  ['s/walden.epub', { file: E, title: 'Walden', author: 'Henry David Thoreau' }],
  ['s/siddhartha.epub', { file: E, title: 'Siddhartha', author: 'Hermann Hesse' }],
  ['s/dalloway.epub', { file: E, title: 'Mrs Dalloway', author: 'Virginia Woolf', available: false, status: 'reading', progress: 0.27, openedMinutesAgo: 20000 }],
  ['s/room.epub', { file: E, title: 'A Room of One’s Own', author: 'Virginia Woolf', status: 'finished', progress: 1 }],
  ['s/legacy.epub', { file: E, title: 'A Legacy Edition', author: 'Quire Press' }],
];

async function seed(page: Page, books = BOOKS) {
  await page.evaluate(async (list) => {
    const f = (globalThis as any).__QUIRE_FAKE__;
    await f.resetLibrary();
    list.forEach(([name, e], i) => f.addFixture(name, { needsCover: false, addedDaysAgo: i, ...e }));
    f.emitLibraryChanged([]);
  }, books);
}

async function boot(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('library-view')).toBeVisible();
  await seed(page);
  await expect(page.getByTestId('shelf-heading')).toContainText(`· ${BOOKS.length}`);
}

const shelf = (page: Page) => page.getByTestId('library-shelf');
const titles = (page: Page) => shelf(page).getByTestId('book').evaluateAll((els) => els.map((e) => e.getAttribute('data-title')!));
const tile = (page: Page, title: string) => shelf(page).getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`) });
const useList = (page: Page) => page.getByRole('radio', { name: 'Compact list' }).click(); // every book in the DOM at 52px rows
const choose = async (page: Page, button: string, item: string | RegExp) => {
  await page.getByTestId(button).click();
  await page.locator(':popover-open').getByRole('menuitemcheckbox', { name: item }).click();
};

test('the library lists the fixtures with their titles', async ({ page }) => {
  await boot(page);
  await useList(page);
  await page.setViewportSize({ width: 1280, height: 3000 });
  await expect.poll(async () => (await titles(page)).sort()).toEqual(BOOKS.map(([, e]) => e.title as string).sort());
  await expect(page.getByTestId('continue-reading')).toContainText('The Left Hand of Darkness');
});

test('sort and filter change the order and the set', async ({ page }) => {
  await boot(page);
  await useList(page);
  await page.setViewportSize({ width: 1280, height: 3000 });
  await page.getByTestId('sort-button').click();
  await page.locator(':popover-open').getByRole('menuitemcheckbox', { name: 'Title' }).click();
  await expect.poll(async () => (await titles(page))[0]).toBe('A Legacy Edition');
  const byTitle = await titles(page);
  expect([...byTitle]).toEqual([...byTitle].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));

  await choose(page, 'filter-button', 'Finished');
  await expect(page.getByTestId('shelf-heading')).toContainText('Finished');
  const finished = await titles(page);
  expect(finished).toContain('Middlemarch');
  expect(finished).not.toContain('Moby-Dick');

  await choose(page, 'filter-button', /Comics/);
  await expect.poll(() => titles(page)).toEqual(['Maus']);
});

test('typing filters by title and author, Esc clears', async ({ page }) => {
  await boot(page);
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.type('woolf'); // type-to-search from anywhere
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.getByRole('searchbox')).toHaveValue('woolf');
  await expect.poll(() => titles(page)).toEqual(expect.arrayContaining(['Mrs Dalloway', 'A Room of One’s Own']));
  expect(await titles(page)).toHaveLength(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect.poll(async () => (await titles(page)).length).toBeGreaterThan(2);
});

test('arrow keys move through the grid and Enter opens a book', async ({ page }) => {
  await boot(page);
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('ArrowRight'); // lands on the first book
  const first = shelf(page).getByTestId('book').first();
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(shelf(page).getByTestId('book').nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const cols = await shelf(page).evaluate((el) => {
    const tops = [...el.querySelectorAll('[data-testid=book]')].map((b) => b.getBoundingClientRect().top);
    return tops.filter((t) => t === tops[0]).length;
  });
  await expect(shelf(page).getByTestId('book').nth(1 + cols)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  await expect(first).toBeFocused();
  const title = await first.getAttribute('data-title');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('reader-view')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (globalThis as any).__QUIRE__.app.book?.title)).toBe(title);
});

test('mark finished updates the status', async ({ page }) => {
  await boot(page);
  const book = tile(page, 'Thinking, Fast and Slow');
  await expect(book).toHaveAttribute('aria-label', /8% read/);
  await book.click({ button: 'right' });
  await page.locator(':popover-open').getByRole('menuitem', { name: 'Mark as finished' }).click();
  await expect(book).toHaveAttribute('aria-label', /finished/);
  await choose(page, 'filter-button', 'Finished');
  await expect(tile(page, 'Thinking, Fast and Slow')).toBeVisible();
});

test('edit details changes the title', async ({ page }) => {
  await boot(page);
  await tile(page, 'Meditations').focus();
  await page.keyboard.press('F2');
  const dialog = page.getByTestId('edit-book');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Title').fill('Meditations, Book One');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(tile(page, 'Meditations, Book One')).toBeVisible();
});

test('remove hides the book, Undo brings it back', async ({ page }) => {
  await boot(page);
  await page.getByRole('searchbox').fill('dune');
  await tile(page, 'Dune').focus();
  await page.keyboard.press('Delete');
  await expect(tile(page, 'Dune')).toHaveCount(0);
  await expect(page.getByText('Removed “Dune” from your library')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(tile(page, 'Dune')).toBeVisible();
  // after the undo window the removal sticks (the file itself is never touched)
  await tile(page, 'Dune').focus();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(7500);
  await page.getByRole('searchbox').fill('');
  await page.getByRole('searchbox').fill('dune');
  await expect(page.getByTestId('library-no-match')).toBeVisible();
});

test('Ctrl+P switches book', async ({ page }) => {
  await boot(page);
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Control+p');
  const palette = page.getByTestId('palette');
  await expect(palette).toBeVisible();
  await page.keyboard.type('mobdck');
  await expect(palette.getByRole('option').first()).toContainText('Moby-Dick');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('reader-view')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (globalThis as any).__QUIRE__.app.book?.title)).toBe('Moby-Dick');
  // and again from the reader
  await page.keyboard.press('Control+p');
  await page.keyboard.type('two open');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (globalThis as any).__QUIRE__.app.book?.title)).toBe('Two Openings');
});

test('collections: create from a book, then filter by it', async ({ page }) => {
  await boot(page);
  await page.getByRole('searchbox').fill('walden');
  await tile(page, 'Walden').click({ button: 'right' });
  await page.locator(':popover-open').getByRole('menuitem', { name: 'New collection…' }).click();
  const dialog = page.getByTestId('collection-dialog');
  await dialog.getByLabel('Name').fill('Summer');
  await page.getByRole('button', { name: 'Create' }).click();
  const chip = page.getByTestId('collections').getByRole('button', { name: /Summer/ });
  await page.getByRole('searchbox').fill('');
  await expect(chip).toContainText('1');
  // add a second book through the menu's collection checkbox
  await page.getByRole('searchbox').fill('siddhartha');
  await tile(page, 'Siddhartha').click({ button: 'right' });
  await page.locator(':popover-open').getByRole('menuitemcheckbox', { name: 'Summer' }).click();
  await page.getByRole('searchbox').fill('');
  await expect(chip).toContainText('2');
  await chip.click();
  await expect.poll(() => titles(page).then((t) => t.sort())).toEqual(['Siddhartha', 'Walden']);
});

test('an unavailable book shows its state and opening it explains calmly', async ({ page }) => {
  await boot(page);
  await page.getByRole('searchbox').fill('dalloway');
  const book = tile(page, 'Mrs Dalloway');
  await expect(book).toHaveAttribute('aria-label', /unavailable/);
  await expect(book).toContainText('Unavailable');
  await book.click();
  await expect(page.getByRole('alertdialog').or(page.getByRole('dialog'))).toContainText('Quire can’t find this file');
  await expect(page.getByTestId('reader-view')).toHaveCount(0);
});

test('full-text hits open the book at the hit', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const { core, lib } = (globalThis as any).__QUIRE_LIBRARY__;
    const id = (lib.books as { id: string; title: string }[]).find((b) => b.title === 'Two Openings')!.id;
    await core.indexBookChunks(id, [{ locator: { kind: 'reflow', cfi: 'epubcfi(/6/4)', fraction: 0.4 }, text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune must be in want of a wife.' }], true, true);
  });
  await page.getByRole('searchbox').fill('universally');
  const found = page.getByTestId('found-in-books');
  await expect(found).toContainText('Two Openings');
  await expect(found.locator('mark').first()).toHaveText('universally');
  await found.getByRole('button', { name: /truth universally/ }).click();
  await expect(page.getByTestId('reader-view')).toBeVisible();
  const at = await page.evaluate(() => (globalThis as any).__QUIRE__.app.book?.initialLocator);
  expect(at).toMatchObject({ kind: 'reflow', fraction: 0.4 });
});

test('an empty library invites books in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('library-view')).toBeVisible();
  await seed(page, []);
  await expect(page.getByText('Your shelves are empty')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add books' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watch a folder' })).toBeVisible();
  // a newly opened file shows up in the library on return
  await page.evaluate(() => (globalThis as any).__QUIRE__.openDocument('pdf/text.pdf'));
  await expect(page.getByTestId('reader-view')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('book').first()).toBeVisible();
});

test('settings: watched folders add and remove', async ({ page }) => {
  await boot(page);
  await page.evaluate((p) => ((globalThis as any).__QUIRE_PICK__ = [p]), String.raw`C:\Books`);
  await page.keyboard.press('Control+,');
  await page.locator('[data-section="library"]').click();
  await page.getByRole('button', { name: 'Add folder…' }).click();
  const list = page.getByTestId('watched-folders');
  await expect(list).toContainText(String.raw`C:\Books`);
  await list.getByRole('button', { name: /Stop watching/ }).click();
  await expect(list).toContainText('No watched folders yet');
});
