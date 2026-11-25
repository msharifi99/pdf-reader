import { test, expect } from './helpers/test';
import { boot, closeDoc, openDoc, R } from './helpers/reader';

// Story 36: every book reopens at exactly the position where the reader stopped (same first visible line),
// also after a window resize and a typography change. Run with --repeat-each=20 to prove it is not intermittent.

test.beforeEach(async ({ page }) => boot(page));

/** The first visible line (reflow text / PDF page+y / comic page) once the layout has held still. */
async function where(page: Page): Promise<string> {
  let last = '';
  let same = 0;
  for (let i = 0; i < 60 && same < 4; i++) {
    const now = (await R(
      page,
      `(r) => { const s = r.session; const l = s.location?.locator; const t = s.engine?.visibleText?.(200) ?? ''; return JSON.stringify([l && (l.kind === 'reflow' ? l.cfi : [l.page, Math.round(l.y ?? 0)]), t]); }`,
    )) as string;
    same = now === last ? same + 1 : 0;
    last = now;
    await page.waitForTimeout(150);
  }
  return last;
}
type Page = import('@playwright/test').Page;

const reflow = ['reflow/epub3.epub', 'reflow/epub2.epub', 'reflow/mobi.mobi', 'reflow/fb2.fb2', 'reflow/azw3.azw3'];

for (const file of reflow) {
  test(`${file}: reopens on the same first line, also after a resize and a typography change`, async ({ page }) => {
    await openDoc(page, file);
    await R(page, '(r) => r.session.jump({ fraction: 0.55 })');
    await where(page);
    // resize the window, then change the typography: each re-lays-out the page
    await page.setViewportSize({ width: 1000, height: 700 });
    await where(page);
    await R(page, '(r) => r.session.setBookSetting({ typography: { ...r.session.typography, fontSize: 22 } })');
    const stopped = await where(page);
    await closeDoc(page);
    await openDoc(page, file);
    expect(await where(page)).toBe(stopped);
    // and once more: a page turn, a resize, close at once (the settle is still pending at close)
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(350);
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.waitForTimeout(150);
    await closeDoc(page);
    await openDoc(page, file);
    const reopened = await where(page);
    await closeDoc(page);
    await openDoc(page, file);
    expect(await where(page)).toBe(reopened);
  });
}

test('PDF reopens on the same page and offset', async ({ page }) => {
  await openDoc(page, 'pdf/text.pdf');
  await R(page, '(r) => r.session.jump({ kind: "fixed", page: 2, y: 0 })');
  await expect.poll(() => where(page)).toContain('[2,');
  const stopped = await where(page);
  await closeDoc(page);
  await openDoc(page, 'pdf/text.pdf');
  expect(await where(page)).toBe(stopped);
});

test('comic reopens on the same page', async ({ page }) => {
  await openDoc(page, 'comic/comic.cbz');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => where(page)).toContain('[2,');
  const stopped = await where(page);
  await closeDoc(page);
  await openDoc(page, 'comic/comic.cbz');
  expect(await where(page)).toBe(stopped);
});
