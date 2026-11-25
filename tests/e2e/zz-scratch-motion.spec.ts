import { test, expect } from '@playwright/test';
const OUT = process.env.SHOTS_DIR!;
test('theme crossfade in reader', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as any).__QUIRE__);
  await page.evaluate(() => (globalThis as any).__QUIRE__.settings.set('theme', 'dark'));
  await page.evaluate(() => (globalThis as any).__QUIRE__.openDocument('reflow/epub3.epub'));
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 20000 });
  await page.waitForTimeout(800);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.05 });
  await page.evaluate(() => (globalThis as any).__QUIRE__.settings.set('theme', 'solarized-light'));
  for (const t of [100, 1000, 2500, 4500]) {
    await page.waitForTimeout(t === 100 ? 100 : t - [100, 1000, 2500, 4500][[100, 1000, 2500, 4500].indexOf(t) - 1]);
    await page.screenshot({ path: `${OUT}/motion-theme-${t}.png` });
  }
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  // panel open
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
  await page.evaluate(() => (globalThis as any).__QUIRE__.commands.execute('annotate.togglePanel'));
  for (const t of [150, 600, 1500]) {
    await page.waitForTimeout(t === 150 ? 150 : t === 600 ? 450 : 900);
    await page.screenshot({ path: `${OUT}/motion-panel-${t}.png` });
  }
});
