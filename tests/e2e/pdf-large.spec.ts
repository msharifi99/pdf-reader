// Range loading of a ~600 MB PDF against a server that mimics src-tauri/src/protocol.rs
// (16 MB response cap, 206 for a Range-less request on a big file, CORS headers).
import { test, expect } from './helpers/test';
import { statSync } from 'node:fs';
import type { Server } from 'node:http';
import { FILE, LARGE_PAGES as PAGES, serveLarge } from './helpers/large-pdf';

const PORT = 4599;
let server: Server;
let stats: { bytes: number; requests: string[] };
test.beforeAll(async () => {
  test.setTimeout(600_000);
  ({ server, stats } = await serveLarge(PORT));
  test.info().annotations.push({ type: 'file', description: `${FILE} ${(statSync(FILE).size / 1e6).toFixed(0)} MB` });
});
test.afterAll(() => void server?.close());

test('600 MB PDF opens over capped range responses without downloading the file', async ({ page }) => {
  test.setTimeout(120_000);
  stats.bytes = 0;
  stats.requests = [];
  await page.goto('/harness/pdf.html');
  const url = `http://localhost:${PORT}/large.pdf`;
  const err = await page.evaluate((u) => (window as any).__h.open(u), url);
  if (err) console.log(JSON.stringify(err), stats.requests.join(String.fromCharCode(10)));
  expect(err).toBeNull();
  await expect(page.locator('.q-page[data-page="0"][data-rendered="true"]')).toBeVisible();
  const t = await page.evaluate(() => (window as any).__h.timing);
  const served = stats.bytes;
  console.log(`large.pdf: first page ${t.firstPaintMs.toFixed(0)} ms, ${(served / 1e6).toFixed(2)} MB served in ${stats.requests.length} requests`);
  console.log(stats.requests.slice(0, 40).join('\n'));
  expect(t.firstPaintMs).toBeLessThan(1500);
  expect(served).toBeLessThan(10e6);
  expect((await page.evaluate(() => (window as any).__h.handle.pageCount))).toBe(PAGES);

  await page.evaluate(() => (window as any).__h.engine.goTo({ kind: 'fixed', page: 1999, y: 0 }));
  await expect(page.locator('.q-page[data-page="1999"][data-rendered="true"] .textLayer')).toContainText('Page 2000');
  console.log(`after jump to 2000: ${(stats.bytes / 1e6).toFixed(2)} MB served in ${stats.requests.length} requests`);
  expect(stats.bytes).toBeLessThan(0.2 * statSync(FILE).size);
});
