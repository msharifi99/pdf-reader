import { test, expect, type Page } from '@playwright/test';
import { installFakeSpeech } from './speech-helpers';

// Read-aloud (T13 UI): player, transport, word highlight, stop on close. A fake speechSynthesis is injected
// before the app boots; the test drives it: __fakeSpeech.word() fires the next word boundary, .end() ends
// the current utterance (the next queued one starts).

const fs = <T>(page: Page, fn: string) => page.evaluate(`globalThis.__fakeSpeech.${fn}`) as Promise<T>;

async function boot(page: Page) {
  await page.addInitScript(installFakeSpeech);
  await page.goto('/');
  await page.waitForFunction(() => (globalThis as any).__QUIRE__);
}
async function open(page: Page, path: string) {
  await page.evaluate((p) => (globalThis as any).__QUIRE__.openDocument(p), path);
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
}
const player = (page: Page) => page.getByTestId('speech-player');

test.beforeEach(async ({ page }) => boot(page));

test('Ctrl+Shift+S starts reading; pause, resume, next sentence, stop', async ({ page }) => {
  await open(page, 'reflow/epub3.epub');
  await expect(player(page)).toHaveCount(0);
  await page.keyboard.press('Control+Shift+S');
  await expect(player(page)).toBeVisible();
  await expect(player(page)).toHaveAttribute('data-state', 'speaking');
  await expect.poll(() => fs<number>(page, 'spoken.length')).toBeGreaterThan(0);
  const first = await fs<string>(page, 'text');
  expect(first.length).toBeGreaterThan(0);

  // pause / resume (keyboard toggle and the button)
  await page.keyboard.press('Control+Shift+S');
  await expect(player(page)).toHaveAttribute('data-state', 'paused');
  expect(await fs<boolean>(page, 'paused')).toBe(true);
  await page.getByTestId('speech-toggle').click();
  await expect(player(page)).toHaveAttribute('data-state', 'speaking');
  expect(await fs<boolean>(page, 'paused')).toBe(false);

  // next sentence
  await page.getByTestId('speech-next').click();
  await expect.poll(() => fs<string>(page, 'text')).not.toBe(first);
  const second = await fs<string>(page, 'text');
  await page.keyboard.press('Control+Shift+ArrowLeft');
  await expect.poll(() => fs<string>(page, 'text')).toBe(first);
  await page.keyboard.press('Control+Shift+ArrowRight');
  await expect.poll(() => fs<string>(page, 'text')).toBe(second);

  // speed shortcut + display
  await page.keyboard.press('Control+Shift+ArrowUp');
  await expect(page.getByTestId('speech-speed')).toHaveText('1.1×');

  // stop hides the player
  await page.getByTestId('speech-stop').click();
  await expect(player(page)).toHaveCount(0);
  expect(await fs<string | null>(page, 'text')).toBeNull();
});

test('the spoken word highlight follows boundary events (EPUB)', async ({ page }) => {
  await open(page, 'reflow/epub3.epub');
  await page.keyboard.press('Control+Shift+S');
  await expect(player(page)).toBeVisible();
  await expect.poll(() => fs<number>(page, 'spoken.length')).toBeGreaterThan(0);
  const wordAnchor = () =>
    page.evaluate(() => {
      const e = (globalThis as any).__QUIRE_READER__.session.engine;
      const w = e.decos?.get('speech')?.get('word');
      return w ? (w.anchor.cfiRange ?? null) : null;
    });
  expect(await fs<string>(page, 'word()')).toBeTruthy();
  await expect.poll(wordAnchor).toMatch(/^epubcfi\(/);
  const a = await wordAnchor();
  await fs(page, 'word()');
  await expect.poll(wordAnchor).not.toBe(a);
  // the overlay draws it inside the page
  await expect
    .poll(() => page.evaluate(() => (globalThis as any).__QUIRE_READER__.session.engine.contents()?.overlayer?.element.querySelectorAll('g').length ?? 0))
    .toBeGreaterThan(0);
});

test('the spoken word highlight follows boundary events (PDF), and the sentence progress moves', async ({ page }) => {
  await open(page, 'pdf/text.pdf');
  await page.keyboard.press('Control+Shift+S');
  await expect(player(page)).toBeVisible();
  await expect.poll(() => fs<number>(page, 'spoken.length')).toBeGreaterThan(0);
  await fs(page, 'word()');
  const word = page.locator('.q-d-speech-word').first();
  await expect(word).toBeVisible();
  const b1 = await word.boundingBox();
  await fs(page, 'word()');
  await expect.poll(async () => JSON.stringify(await word.boundingBox())).not.toBe(JSON.stringify(b1));
  const b2 = await word.boundingBox();
  await fs(page, 'word()'); // next line
  await expect.poll(async () => JSON.stringify(await word.boundingBox())).not.toBe(JSON.stringify(b2));
  await expect(page.locator('.q-d-speech-sentence').first()).toBeVisible();
  const scale = await page.locator('[data-testid=speech-player] .fill').evaluate((el) => getComputedStyle(el).scale);
  expect(parseFloat(scale)).toBeGreaterThan(0);
});

test('closing the book stops speech', async ({ page }) => {
  await open(page, 'reflow/epub3.epub');
  await page.keyboard.press('Control+Shift+S');
  await expect(player(page)).toBeVisible();
  await expect.poll(() => fs<string | null>(page, 'text')).not.toBeNull();
  await page.evaluate(() => (globalThis as any).__QUIRE__.closeBook());
  await expect(page.getByTestId('reader-view')).toHaveCount(0);
  expect(await fs<string | null>(page, 'text')).toBeNull();
  expect(await fs<boolean>(page, 'pending')).toBe(false);
});

test('voice picker groups voices by language with the book language first, and picks one', async ({ page }) => {
  await open(page, 'reflow/epub3.epub');
  await page.getByTestId('speech-start').click();
  await expect(player(page)).toBeVisible();
  await page.getByTestId('speech-voice').click();
  const picker = page.getByTestId('voice-picker');
  await expect(picker).toBeVisible();
  const groups = await picker.locator('.group .label').allTextContents();
  expect(groups[0]).toMatch(/English/);
  expect(groups.some((g) => /French/.test(g))).toBe(true);
  await picker.getByRole('button', { name: 'Hazel', exact: true }).click();
  await expect(page.getByTestId('speech-voice')).toContainText('Hazel');
  await expect(picker).toBeHidden();
});
