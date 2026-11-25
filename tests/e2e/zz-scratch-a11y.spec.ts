import { test, expect, type Page } from '@playwright/test';
const OUT = process.env.SHOTS_DIR!;
const unnamed = (page: Page) => page.evaluate(() => [...document.querySelectorAll('button, [role=button], a[href], input, select, [tabindex]:not([tabindex="-1"])')]
  .filter((e) => (e as HTMLElement).offsetParent !== null)
  .filter((e) => !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.textContent ?? '').trim() || e.getAttribute('title') || (e as HTMLInputElement).labels?.length || e.getAttribute('placeholder')))
  .map((e) => e.outerHTML.slice(0, 160)));
async function tabs(page: Page, n: number, tag: string) {
  const seq: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(() => { const a = document.activeElement as HTMLElement; const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return `${a.tagName.toLowerCase()} "${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 30)}" ${Math.round(r.x)},${Math.round(r.y)} outline=${cs.outlineStyle}/${cs.outlineWidth}`; });
    seq.push(d);
    if (i % 6 === 0) await page.screenshot({ path: `${OUT}/tab-${tag}-${i}.png` });
  }
  console.log(tag + '\n' + seq.join('\n'));
}
test('a11y', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('library-view')).toBeVisible();
  await page.waitForTimeout(500);
  console.log('library unnamed', await unnamed(page));
  await tabs(page, 20, 'library');
  await page.evaluate(() => (globalThis as any).__QUIRE__.openDocument('reflow/epub3.epub'));
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 20000 });
  await page.waitForTimeout(600);
  console.log('reader unnamed', await unnamed(page));
  await tabs(page, 18, 'reader');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(400);
  console.log('settings unnamed', await unnamed(page));
  await tabs(page, 14, 'settings');
});
