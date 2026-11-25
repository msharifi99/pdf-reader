import { expect, type Page } from '@playwright/test';

// Shared reader helpers for specs (fake core, fixtures under public/fixtures).
export async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as any).__QUIRE__);
}
export async function openDoc(page: Page, path: string) {
  await page.evaluate((p) => (globalThis as any).__QUIRE__.openDocument(p), path);
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
}
export async function closeDoc(page: Page) {
  await page.evaluate(() => (globalThis as any).__QUIRE__.closeBook());
  await expect(page.getByTestId('reader-view')).toHaveCount(0);
}
/** Run `fn` (a source string `(r) => ...`) against `__QUIRE_READER__`; the result comes back as plain JSON. */
export const R = (page: Page, fn: string) =>
  page.evaluate(`(async () => { const r = globalThis.__QUIRE_READER__; const v = await (${fn})(r); return v === undefined ? null : JSON.parse(JSON.stringify(v)); })()`);
