import { type Page } from '@playwright/test';
import { test, expect } from './helpers/test';

// Reader (T8): open flow, navigation, find, history, per-book settings, progress. Fake core, fixtures under public/fixtures.

type Loc = { kind: 'fixed'; page: number; y?: number } | { kind: 'reflow'; cfi: string; fraction: number };

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as any).__QUIRE__);
}
async function open(page: Page, path: string) {
  await page.evaluate((p) => (globalThis as any).__QUIRE__.openDocument(p), path);
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
}
const R = (page: Page, fn: string) => page.evaluate(`(async () => { const r = globalThis.__QUIRE_READER__; const v = await (${fn})(r); return v === undefined ? null : JSON.parse(JSON.stringify(v)); })()`);
const loc = (page: Page) => R(page, '(r) => r.session.location?.locator') as Promise<Loc>;
const pageNo = async (page: Page) => ((await loc(page)) as { page: number }).page;
const fraction = (page: Page) => R(page, '(r) => r.session.location?.progress.fraction') as Promise<number>;
const bookId = (page: Page) => R(page, '(r) => r.session.book.id') as Promise<string>;
const run = (page: Page, id: string) => page.evaluate((id) => (globalThis as any).__QUIRE__.commands.execute(id), id);
/** PDFs open in continuous scroll, where Next is a screenful; paginated makes Next exactly one page. */
async function paginate(page: Page) {
  if ((await R(page, '(r) => r.session.flow')) !== 'paginated') await run(page, 'reader.toggleFlow');
  await expect.poll(() => R(page, '(r) => r.session.flow')).toBe('paginated');
}
async function close(page: Page) {
  await page.evaluate(() => (globalThis as any).__QUIRE__.closeBook());
  await expect(page.getByTestId('reader-view')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => boot(page));

test('PDF: next/prev pages, g g and G', async ({ page }) => {
  await open(page, 'pdf/text.pdf');
  await paginate(page);
  expect(await pageNo(page)).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => pageNo(page)).toBe(1);
  await page.keyboard.press('PageDown');
  await expect.poll(() => pageNo(page)).toBe(2);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => pageNo(page)).toBe(1);
  await page.keyboard.press('Shift+G');
  await expect.poll(() => pageNo(page)).toBe(11);
  await expect(page.getByTestId('reader-position')).toContainText('12 of 12');
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect.poll(() => pageNo(page)).toBe(0);
});

test('reopens at the saved position: PDF, EPUB and comic', async ({ page }) => {
  await open(page, 'pdf/text.pdf');
  await R(page, '(r) => r.session.jump({ kind: "fixed", page: 6, y: 0 })');
  await expect.poll(() => pageNo(page)).toBe(6);
  await close(page);
  await open(page, 'pdf/text.pdf');
  expect(await pageNo(page)).toBe(6);
  await close(page);

  await open(page, 'reflow/epub3.epub');
  await R(page, '(r) => r.session.jump({ fraction: 0.6 })');
  await expect.poll(() => fraction(page)).toBeGreaterThan(0.4);
  const before = (await loc(page)) as { cfi: string };
  await close(page);
  await open(page, 'reflow/epub3.epub');
  expect(((await loc(page)) as { cfi: string }).cfi).toBe(before.cfi);
  await close(page);

  await open(page, 'comic/comic.cbz');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => pageNo(page)).toBeGreaterThan(0);
  const comicPage = await pageNo(page);
  await close(page);
  await open(page, 'comic/comic.cbz');
  expect(await pageNo(page)).toBe(comicPage);
});

test('progress is saved 2 s after moving, and at once on close', async ({ page }) => {
  await open(page, 'pdf/text.pdf');
  await paginate(page);
  const id = await bookId(page);
  const saved = () => page.evaluate((id) => (globalThis as any).__QUIRE_READER__?.core.getProgress(id) ?? null, id).then((p) => p?.locator?.page ?? null);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => pageNo(page)).toBe(1);
  expect(await saved()).not.toBe(1); // not written straight away
  await page.waitForTimeout(2300);
  expect(await saved()).toBe(1);

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => pageNo(page)).toBe(2);
  const core = await page.evaluateHandle(() => (globalThis as any).__QUIRE_READER__.core);
  await close(page);
  await expect.poll(() => core.evaluate((c, id) => c.getProgress(id).then((p: any) => p?.locator?.page), id)).toBe(2);
});

test('TOC: jump to an entry, current chapter is highlighted, Esc closes', async ({ page }) => {
  await open(page, 'pdf/text.pdf');
  await paginate(page);
  await page.keyboard.press('t');
  const toc = page.getByTestId('toc');
  await expect(toc).toBeVisible();
  await expect(toc.getByRole('treeitem', { name: /Part one/ })).toBeVisible();
  await toc.getByRole('treeitem', { name: /Epilogue/ }).click();
  await expect.poll(() => pageNo(page)).toBeGreaterThan(2);
  await expect(toc.locator('[aria-current="location"]')).toContainText('Epilogue');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('reader-sidebar')).toHaveCount(0);
});

test('history: Alt+Left returns from a jump, Alt+Right goes forward again', async ({ page }) => {
  await open(page, 'pdf/text.pdf');
  await paginate(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => pageNo(page)).toBe(1);
  await page.keyboard.press('Shift+G');
  await expect.poll(() => pageNo(page)).toBe(11);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(() => pageNo(page)).toBe(1);
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => pageNo(page)).toBe(11);
});

test('Ctrl+F finds matches and Enter steps through them', async ({ page }) => {
  await open(page, 'pdf/text.pdf');
  await page.keyboard.press('Control+f');
  const bar = page.getByTestId('find-bar');
  await expect(bar).toBeVisible();
  await page.keyboard.type('lamp');
  const count = page.getByTestId('find-count');
  await expect(count).toHaveText(/^1 of \d+$/, { timeout: 10_000 });
  const total = Number((await count.textContent())!.split(' of ')[1]);
  expect(total).toBeGreaterThan(1);
  await page.keyboard.press('Enter');
  await expect(count).toHaveText(`2 of ${total}`);
  await page.keyboard.press('Shift+Enter');
  await expect(count).toHaveText(`1 of ${total}`);
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
});

test('typography change keeps the reading position', async ({ page }) => {
  await open(page, 'reflow/epub3.epub');
  await R(page, '(r) => r.session.jump({ fraction: 0.5 })');
  await expect.poll(() => fraction(page)).toBeGreaterThan(0.3);
  const before = await fraction(page);
  const size = () => R(page, `(r) => r.session.typography.fontSize`) as Promise<number>;
  // the book sets p.tx { font-size: 12pt }: the paragraphs themselves must grow, not just <html>
  const pSize = () => R(page, `(r) => parseFloat(getComputedStyle(r.session.engine.contents().doc.querySelector('p.tx')).fontSize)`) as Promise<number>;
  const start = await size();
  const startP = await pSize();
  await page.keyboard.press('Control+Equal');
  await page.keyboard.press('Control+Equal');
  await expect.poll(size).toBe(start + 2);
  await expect.poll(pSize).toBeGreaterThan(startP);
  await page.waitForTimeout(800);
  expect(Math.abs((await fraction(page)) - before)).toBeLessThan(0.12);
  await page.keyboard.press('Control+Minus');
  await expect.poll(size).toBe(start + 1);
  await page.keyboard.press('Control+0');
  await expect.poll(size).toBe(start);
  await expect.poll(pSize).toBe(startP);
});

test('scrolled EPUB: Page Down/Up walk the book in order, landing on section starts and ends', async ({ page }) => {
  await open(page, 'reflow/epub3.epub');
  await run(page, 'reader.toggleFlow');
  await expect.poll(() => R(page, '(r) => r.session.flow')).toBe('scrolled');
  await page.waitForTimeout(500);
  const at = () => R(page, '(r) => { const e = r.session.engine; return [e.contents().index, Math.round(e.renderer.start), r.session.location.progress.fraction]; }') as Promise<[number, number, number]>;
  const walk = async (key: string) => {
    const seen: [number, number, number][] = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press(key);
      await page.waitForTimeout(600);
      seen.push(await at());
    }
    return seen;
  };
  const key = (p: [number, number, number]) => p[0] * 1e5 + p[1];
  const down = await walk('PageDown');
  for (let i = 1; i < down.length; i++) {
    expect(key(down[i]!)).toBeGreaterThanOrEqual(key(down[i - 1]!));
    expect(down[i]![2]).toBeGreaterThanOrEqual(down[i - 1]![2]);
    // a step into a new section lands on its top, not partway down
    if (down[i]![0] !== down[i - 1]![0]) expect(down[i]![1]).toBe(0);
  }
  expect(down.at(-1)![0]).toBeGreaterThan(2);
  const up = await walk('PageUp');
  for (let i = 1; i < up.length; i++) expect(key(up[i]!)).toBeLessThanOrEqual(key(up[i - 1]!));
  expect(up.at(-1)![0]).toBeLessThan(down.at(-1)![0]);
});

test('flow is remembered per book', async ({ page }) => {
  await open(page, 'reflow/epub3.epub');
  await run(page, 'reader.toggleFlow');
  await expect.poll(() => R(page, '(r) => r.session.flow')).toBe('scrolled');
  await page.waitForTimeout(500);
  await close(page);
  await open(page, 'reflow/epub3.epub');
  expect(await R(page, '(r) => r.session.flow')).toBe('scrolled');
  await close(page);
  await open(page, 'reflow/epub2.epub');
  expect(await R(page, '(r) => r.session.flow')).toBe('paginated');
});

test('page tint is remembered per book', async ({ page }) => {
  await open(page, 'pdf/text.pdf');
  await run(page, 'reader.pageTint.invert');
  await page.waitForTimeout(500);
  await close(page);
  await open(page, 'pdf/text.pdf');
  expect(await R(page, '(r) => r.session.pageTint')).toBe('invert');
});

test('focus mode hides the chrome; the ruler appears', async ({ page }) => {
  await open(page, 'reflow/epub3.epub');
  await expect(page.getByTestId('reader-status')).toBeVisible();
  await page.keyboard.press('f');
  await expect(page.locator('html')).toHaveAttribute('data-reader-focus', /.*/);
  for (const el of [page.getByTestId('reader-status'), page.locator('header.titlebar')]) await expect(el).toHaveCSS('opacity', '0');
  await page.keyboard.press('f');
  await expect(page.getByTestId('reader-status')).not.toHaveCSS('opacity', '0');
  await page.keyboard.press('r');
  await expect(page.getByTestId('reading-ruler')).toBeVisible();
  await page.keyboard.press('r');
  await expect(page.getByTestId('reading-ruler')).toHaveCount(0);
});

test('password: a wrong one is refused, the right one opens', async ({ page }) => {
  await page.evaluate(() => (globalThis as any).__QUIRE__.openDocument('pdf/encrypted.pdf'));
  const dialog = page.getByTestId('password-dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('input[type=password]').fill('nope');
  await page.keyboard.press('Enter');
  await expect(dialog).toContainText(/incorrect|wrong|didn.t work/i);
  await dialog.locator('input[type=password]').fill('quire');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
});

test('a corrupt file gives a calm error and returns to the library', async ({ page }) => {
  await page.evaluate(() => (globalThis as any).__QUIRE__.openDocument('pdf/corrupt.pdf'));
  await expect(page.getByTestId('error-message')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('reader-view')).toHaveCount(0);
  await expect(page.getByTestId('library-view')).toBeVisible();
});
