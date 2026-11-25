import { test, expect, type Page } from '@playwright/test';
import { boot, chapter, close, coreItems, drawn, items, open, seed, selectEpub, selectPdf, settled } from './annotations-helpers';

// Highlights, notes, undo, copy as quote, export (T11).

test.beforeEach(async ({ page }) => boot(page));

/** Click the middle of the first drawn PDF highlight. */
async function clickPdfHighlight(page: Page) {
  const box = await page.locator('[data-layer="annotations"]').first().boundingBox();
  if (!box) throw new Error('no highlight drawn');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('highlight-popover')).toBeVisible();
}

test('EPUB: select, press 2, a green highlight is drawn and survives reopening', async ({ page }) => {
  await open(page, 'reflow/epub3.epub');
  await chapter(page, 0);
  await selectEpub(page, 'It is a truth universally acknowledged');
  await expect(page.getByTestId('selection-menu')).toBeVisible();
  await page.keyboard.press('2');
  await expect.poll(() => items(page)).toMatchObject([{ type: 'highlight', color: 'green', anchor: { quote: { exact: 'It is a truth universally acknowledged' } } }]);
  await expect.poll(() => drawn(page)).toBeGreaterThan(0);
  await expect(page.getByTestId('selection-menu')).toHaveCount(0);
  await settled(page);
  await close(page);
  await open(page, 'reflow/epub3.epub');
  await expect.poll(() => items(page)).toMatchObject([{ color: 'green' }]);
  await expect.poll(() => drawn(page)).toBeGreaterThan(0);
});

test('PDF: select, press 2, a green highlight is drawn and survives reopening', async ({ page }) => {
  await open(page, 'pdf/text.pdf');
  await selectPdf(page, 'harbour pilot climbed');
  await expect(page.getByTestId('selection-menu')).toBeVisible();
  await page.keyboard.press('2');
  await expect.poll(() => items(page)).toMatchObject([{ type: 'highlight', color: 'green' }]);
  await expect(page.locator('[data-layer="annotations"]').first()).toBeVisible();
  await settled(page);
  await close(page);
  await open(page, 'pdf/text.pdf');
  await expect.poll(() => items(page)).toMatchObject([{ color: 'green', anchor: { quote: { exact: 'harbour pilot climbed' } } }]);
  await expect(page.locator('[data-layer="annotations"]').first()).toBeVisible();
});

test('a note is added (N), edited, and saved; Esc cancels an edit', async ({ page }) => {
  await open(page, 'pdf/text.pdf');
  await selectPdf(page, 'cold iron rail');
  await page.keyboard.press('n');
  const editor = page.getByTestId('note-editor');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Rails are cold.');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => items(page)).toMatchObject([{ type: 'note', note: 'Rails are cold.' }]);
  await expect(editor).toHaveCount(0);
  await page.keyboard.press('Escape'); // closes the popover, not the book
  await expect(page.getByTestId('highlight-popover')).toHaveCount(0);
  await expect(page.getByTestId('reader-view')).toHaveCount(1);

  // edit from the popover: click the note, change it, leave the field (blur saves)
  await clickPdfHighlight(page);
  await page.getByTestId('highlight-popover').getByRole('button', { name: 'Edit note' }).click();
  await expect(editor).toHaveValue('Rails are cold.');
  await editor.fill('Iron rails are cold at night.');
  await page.getByTestId('highlight-popover').getByRole('radio', { name: 'Yellow' }).click();
  await expect.poll(() => items(page)).toMatchObject([{ note: 'Iron rails are cold at night.' }]);

  // Esc cancels: the text typed is dropped, the popover stays
  await page.getByTestId('highlight-popover').getByRole('button', { name: 'Edit note' }).click();
  await editor.fill('discard me');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId('highlight-popover')).toBeVisible();
  const id = await page.evaluate(() => (globalThis as any).__QUIRE_READER__.session.book.id);
  await settled(page);
  expect(await coreItems(page, id)).toMatchObject([{ type: 'note', note: 'Iron rails are cold at night.' }]);
});

test('recolour and delete, then Ctrl+Z restores both', async ({ page }) => {
  await open(page, 'pdf/text.pdf');
  await selectPdf(page, 'spiral stair');
  await page.keyboard.press('1');
  await expect.poll(() => items(page)).toMatchObject([{ color: 'yellow' }]);
  await clickPdfHighlight(page);
  await page.getByTestId('highlight-popover').getByRole('radio', { name: 'Blue' }).click();
  await expect.poll(() => items(page)).toMatchObject([{ color: 'blue' }]);
  await page.getByTestId('highlight-popover').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => items(page)).toHaveLength(0);
  await expect(page.locator('[data-layer="annotations"]')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => items(page)).toMatchObject([{ color: 'blue' }]);
  await expect(page.locator('[data-layer="annotations"]').first()).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect.poll(() => items(page)).toMatchObject([{ color: 'yellow' }]);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => items(page)).toMatchObject([{ color: 'blue' }]);
  const id = await page.evaluate(() => (globalThis as any).__QUIRE_READER__.session.book.id);
  await settled(page);
  expect(await coreItems(page, id)).toMatchObject([{ color: 'blue' }]);
});

test('copy as quote puts the quote and its citation on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, 'pdf/text.pdf');
  const meta = await page.evaluate(() => (globalThis as any).__QUIRE_READER__.session.handle.metadata);
  await selectPdf(page, 'counting the steps');
  await page.keyboard.press('Control+Shift+c');
  const author = meta.authors.join(', ');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText().then((t) => t.replace(/\r\n/g, '\n')))).toBe(`“counting the steps”\n— ${[author, `*${meta.title}*`, 'p. i'].filter(Boolean).join(', ')}`);
  // the menu button does the same for an EPUB, citing the chapter
  await open(page, 'reflow/epub3.epub');
  await chapter(page, 0);
  await selectEpub(page, 'a single man in possession');
  await page.getByTestId('selection-menu').getByRole('button', { name: 'Copy as quote' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText().then((t) => t.replace(/\r\n/g, '\n')))).toBe('“a single man in possession”\n— Jane Austen, Herman Melville, *Quire Test Anthology*, Chapter 1: A Truth Universally Acknowledged');
});

test('export writes Obsidian-friendly Markdown', async ({ page }) => {
  await seed(page, 'pdf/text.pdf', [
    { type: 'note', color: 'blue', page: 2, exact: 'Marker-3', note: 'Third marker.' },
    { type: 'highlight', color: 'green', page: 0, exact: 'Marker-1' },
    { type: 'bookmark', page: 1, label: 'Second page' },
  ]);
  await open(page, 'pdf/text.pdf');
  const meta = await page.evaluate(() => (globalThis as any).__QUIRE_READER__.session.handle.metadata);
  await page.keyboard.press('a');
  const dl = page.waitForEvent('download');
  await page.getByTestId('annotations-export').click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe(`${meta.title} - highlights.md`);
  const text = (await (await d.createReadStream()).toArray()).join('').replace(/exported: \d{4}-\d\d-\d\d/, 'exported: DATE');
  const author = meta.authors.join(', ');
  expect(text).toBe(
    [
      '---',
      `title: "${meta.title}"`,
      `author: "${author}"`,
      'format: pdf',
      'exported: DATE',
      'tags: [quire]',
      '---',
      '',
      `# ${meta.title}`,
      ...(author ? ['', `*${author}*`] : []),
      '',
      '## Opening',
      '',
      '> Marker-1',
      '',
      'p. i · #highlight/green',
      '',
      '## The stair',
      '',
      '- **Bookmark**: Second page · p. ii',
      '',
      '## Landscape page',
      '',
      '> Marker-3',
      '',
      'Third marker.',
      '',
      'p. 1 · #highlight/blue',
      '',
    ].join('\n'),
  );
});
