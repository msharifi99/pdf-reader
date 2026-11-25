import { expect, type Page } from '@playwright/test';

// Shared helpers for the annotations specs (T11). Fake core, fixtures under public/fixtures.

export async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as any).__QUIRE__);
}
export async function open(page: Page, path: string) {
  if (await page.getByTestId('reader-view').count()) await close(page);
  await page.evaluate((p) => (globalThis as any).__QUIRE__.openDocument(p), path);
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
  await page.waitForFunction(() => {
    const a = (globalThis as any).__QUIRE_ANNOTATIONS__;
    return a?.store.loaded && a.session === (globalThis as any).__QUIRE_READER__?.session;
  });
}
export async function close(page: Page) {
  await page.evaluate(() => (globalThis as any).__QUIRE__.closeBook());
  await expect(page.getByTestId('reader-view')).toHaveCount(0);
}
/** The open book's annotations (plain data). */
export const items = (page: Page) =>
  page.evaluate(() => JSON.parse(JSON.stringify((globalThis as any).__QUIRE_ANNOTATIONS__.store.items))) as Promise<
    { id: string; type: string; color: string | null; note: string | null; label: string | null; anchor: any }[]
  >;
/** Every write reached the core. */
export const settled = (page: Page) => page.evaluate(() => (globalThis as any).__QUIRE_ANNOTATIONS__.store.settled());
export const run = (page: Page, id: string) => page.evaluate((id) => (globalThis as any).__QUIRE__.commands.execute(id), id);

/** Select `text` in the open EPUB's visible section (inside its iframe). */
export async function selectEpub(page: Page, text: string) {
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const ok = await f
      .evaluate((t) => {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const i = n.textContent!.indexOf(t);
          if (i < 0) continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + t.length);
          const s = getSelection()!;
          s.removeAllRanges();
          s.addRange(r);
          return true;
        }
        return false;
      }, text)
      .catch(() => false);
    if (ok) return expect.poll(() => page.evaluate(() => (globalThis as any).__QUIRE_READER__.session.selection?.text)).toContain(text);
  }
  throw new Error(`"${text}" not found in any section frame`);
}

/** Select `text` in the PDF text layer (main document). */
export async function selectPdf(page: Page, text: string) {
  await expect(page.locator('.textLayer span').first()).toBeAttached({ timeout: 10_000 });
  const ok = await page.evaluate((t) => {
    for (const span of document.querySelectorAll('.textLayer span')) {
      const n = span.firstChild;
      const i = n?.textContent?.indexOf(t) ?? -1;
      if (!n || i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + t.length);
      const s = getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      return true;
    }
    return false;
  }, text);
  if (!ok) throw new Error(`"${text}" not found in the PDF text layer`);
  await expect.poll(() => page.evaluate(() => (globalThis as any).__QUIRE_READER__.session.selection?.text)).toContain(text);
}

/** Number of annotation shapes the engine drew. */
export const drawn = (page: Page) =>
  page.evaluate(() => {
    const pdf = document.querySelectorAll('[data-layer="annotations"]').length;
    const e = (globalThis as any).__QUIRE_READER__.session.engine;
    const reflow = e.contents?.()?.overlayer?.element?.querySelectorAll('g').length ?? 0;
    return pdf + reflow;
  });

type Seed = { type: 'highlight' | 'note' | 'bookmark'; color?: string | null; page?: number; exact?: string; note?: string; label?: string };
/** Create annotations straight in the core for the book at `path` (opens it once to learn its id). Returns the book id. */
export async function seed(page: Page, path: string, list: Seed[]): Promise<string> {
  await open(page, path);
  const id = await page.evaluate(async (list) => {
    const r = (globalThis as any).__QUIRE_READER__;
    const bookId = r.session.book.id;
    for (const s of list)
      await r.core.createAnnotation({
        bookId,
        type: s.type,
        color: s.type === 'bookmark' ? null : (s.color ?? 'yellow'),
        anchor: { locator: { kind: 'fixed', page: s.page ?? 0, y: 0.1 }, quote: { exact: s.exact ?? '', prefix: '', suffix: '' } },
        note: s.note ?? null,
        label: s.label ?? null,
      });
    return bookId as string;
  }, list);
  await close(page);
  return id;
}
/** The core's copy (not the UI's), to prove writes landed. */
export const coreItems = (page: Page, bookId: string) =>
  page.evaluate(async (id) => {
    const g = globalThis as any;
    const core = g.__QUIRE_READER__?.core ?? g.__QUIRE_LIBRARY__?.core;
    return core.listAnnotations(id);
  }, bookId) as Promise<{ id: string; type: string; color: string | null; note: string | null; label: string | null; anchor: any }[]>;

/** Jump to the n-th entry of the flattened table of contents. */
export async function chapter(page: Page, n: number) {
  await page.evaluate(async (n) => {
    const s = (globalThis as any).__QUIRE_READER__.session;
    await s.jump(s.flat[n].entry.locator);
  }, n);
  await page.waitForTimeout(500);
}
