import { test, expect } from '@playwright/test';

// Multi-window fallback and session restore (T14). A browser has one window, so "open in new window"
// opens in place; the persisted session is planted in the fake core's localStorage in the shape Rust saves.

const SESSION_KEY = 'quire.fake.session';
const BOOK = 'fx-text'; // pdf/text.pdf from the fixture manifest
const session = (bookId: string | null) =>
  JSON.stringify({
    version: 1,
    windows: [
      { label: 'main', bookId, bounds: { x: 0, y: 0, w: 1280, h: 800 }, maximized: false },
      { label: 'reader-2', bookId: 'fx-other', bounds: { x: 40, y: 40, w: 1000, h: 700 }, maximized: false },
    ],
  });
const appState = (page: import('@playwright/test').Page) => page.evaluate(() => { const a = (globalThis as any).__QUIRE__?.app; return a ? { view: a.view, id: a.book?.id } : null; });

test('app.newWindow falls back to opening the book in place', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('library-view')).toBeVisible();
  await page.evaluate((bookId) => (globalThis as any).__QUIRE__.commands.execute('app.newWindow', { bookId }), BOOK);
  await expect.poll(() => appState(page)).toEqual({ view: 'reader', id: BOOK });
  expect(page.context().pages()).toHaveLength(1);
});

test('the main window reopens the book it showed last session', async ({ page }) => {
  await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [SESSION_KEY, session(BOOK)]);
  await page.goto('/');
  await expect.poll(() => appState(page)).toEqual({ view: 'reader', id: BOOK });
  // the session is consumed once: closing the book and reloading is up to the saved state, not this plant
  expect(await page.evaluate((k) => localStorage.getItem(k), SESSION_KEY)).toBeNull();
});

test('a session whose main window showed the library stays on the library', async ({ page }) => {
  await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [SESSION_KEY, session(null)]);
  await page.goto('/');
  await expect(page.getByTestId('library-view')).toBeVisible();
  expect((await appState(page))?.view).toBe('library');
});

test('a book the core opened a window for (boot data) is shown straight away, ahead of the session', async ({ page }) => {
  await page.addInitScript(([k, v]) => {
    localStorage.setItem(k!, v!);
    (window as any).__QUIRE_BOOT__ = { bookId: 'fx-comic' };
  }, [SESSION_KEY, session(BOOK)]);
  await page.goto('/');
  await expect.poll(() => appState(page)).toEqual({ view: 'reader', id: 'fx-comic' });
});
