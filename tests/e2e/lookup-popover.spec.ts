import { test, expect, type Page } from '@playwright/test';
import { selectWord } from './speech-helpers';

// Lookup popover (T13 UI): D on a selection defines it from the (fake) offline dictionary; synonyms look up
// again; Wikipedia is only fetched after the tab is clicked (mocked here); disambiguation and offline states.

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as any).__QUIRE__);
}
async function open(page: Page, path: string) {
  await page.evaluate((p) => (globalThis as any).__QUIRE__.openDocument(p), path);
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
}

const pop = (page: Page) => page.getByTestId('lookup-popover');

test.beforeEach(async ({ page }) => boot(page));

test('D defines the selected word from the offline dictionary; a synonym looks up again; Esc closes', async ({ page }) => {
  await open(page, 'reflow/epub3.epub');
  await selectWord(page, 'good');
  await page.keyboard.press('d');
  await expect(pop(page)).toBeVisible();
  const dict = page.getByTestId('lookup-dictionary');
  await expect(dict.getByRole('heading', { name: 'good' })).toBeVisible();
  await expect(dict).toContainText('adjective');
  await expect(dict).toContainText('having desirable or positive qualities');
  await expect(dict.locator('.ex')).toHaveText('“a good book”');

  // never covers the word: the popover sits fully below (or above) the selection
  const sel = await page.evaluate(() => (globalThis as any).__QUIRE_READER__.readerApi.selectionRect());
  const box = (await pop(page).boundingBox())!;
  expect(box.y >= sel.y + sel.height || box.y + box.height <= sel.y).toBe(true);

  await dict.getByRole('button', { name: 'fine' }).click();
  await expect(page.getByTestId('lookup-not-found')).toContainText('“fine”');

  await page.keyboard.press('Escape');
  await expect(pop(page)).toBeHidden();
  await expect(page.getByTestId('reader-view')).toBeVisible(); // Esc closed the popover, not the book
});

test('Wikipedia is fetched only after a click; summary, then disambiguation choices', async ({ page }) => {
  const wikiRequests: string[] = [];
  page.on('request', (r) => r.url().includes('wikipedia.org') && wikiRequests.push(r.url()));
  await page.route(/wikipedia\.org/, (route) => {
    const url = decodeURIComponent(route.request().url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (/\/page\/summary\/fortune\?/i.test(url)) return json({ type: 'disambiguation', title: 'Fortune' });
    if (url.includes('opensearch')) return json(['Fortune', ['Fortune', 'Fortune (goddess)', 'Fortune (magazine)'], ['', 'Roman goddess of luck', 'American business magazine']]);
    if (url.includes('/page/summary/Fortune_(goddess)')) return json({ type: 'standard', title: 'Fortuna', description: 'Roman goddess of luck', extract: 'Fortuna is the goddess of fortune.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Fortuna' } } });
    return json({ type: 'standard', title: 'Good', description: 'Concept in ethics', extract: 'In most contexts, the concept of good denotes the conduct that should be preferred.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Good' } } });
  });
  await open(page, 'reflow/epub3.epub');
  await selectWord(page, 'good');
  await page.keyboard.press('d');
  await expect(page.getByTestId('lookup-dictionary')).toBeVisible();
  await page.waitForTimeout(300);
  expect(wikiRequests).toEqual([]);

  await pop(page).getByRole('tab', { name: 'Wikipedia' }).click();
  const summary = page.getByTestId('lookup-wiki-summary');
  await expect(summary).toContainText('Concept in ethics');
  await expect(summary.getByRole('heading', { name: 'Good' })).toBeVisible();
  await expect(page.getByTestId('lookup-wiki-open')).toBeVisible();
  expect(wikiRequests).toHaveLength(1);
  expect(wikiRequests[0]).toContain('/page/summary/good');

  // a disambiguation page offers related titles; picking one loads it
  await page.keyboard.press('Escape');
  await selectWord(page, 'fortune');
  await page.evaluate(() => (globalThis as any).__QUIRE__.commands.execute('lookup.wikipedia'));
  const choices = page.getByTestId('lookup-wiki-choices');
  await expect(choices).toContainText('can mean several things');
  await choices.getByRole('button', { name: /Fortune \(goddess\)/ }).click();
  await expect(summary).toContainText('Fortuna is the goddess of fortune.');
});

test('Wikipedia offline shows a calm state', async ({ page, context }) => {
  await open(page, 'reflow/epub3.epub');
  await selectWord(page, 'good');
  await page.keyboard.press('d');
  await expect(page.getByTestId('lookup-dictionary')).toBeVisible();
  await context.setOffline(true);
  await pop(page).getByRole('tab', { name: 'Wikipedia' }).click();
  const err = page.getByTestId('lookup-wiki-error');
  await expect(err).toHaveAttribute('data-code', 'offline');
  await expect(err).toContainText('No connection');
  await context.setOffline(false);
});
