import { test, expect, type Page } from '@playwright/test';
import { installFakeSpeech, selectWord } from './speech-helpers';

// Read-aloud + lookup screenshots for design review (T13). Run on demand: SHOTS=1 npx playwright test speech-shots
test.skip(!process.env.SHOTS, 'screenshots only on demand (SHOTS=1)');

const OUT = process.env.SHOTS_DIR ?? 'docs/design';
const THEMES = (process.env.SHOTS_THEMES ?? 'dark,solarized-light,sepia').split(',');

async function open(page: Page, path: string) {
  await page.evaluate((p) => (globalThis as any).__QUIRE__.openDocument(p), path);
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
  await page.waitForTimeout(600);
}
const close = async (page: Page) => {
  await page.evaluate(() => (globalThis as any).__QUIRE__.closeBook());
  await expect(page.getByTestId('reader-view')).toHaveCount(0);
};
const words = async (page: Page, n: number) => {
  for (let i = 0; i < n; i++) await page.evaluate('globalThis.__fakeSpeech.word()');
};
const wake = (page: Page) => page.mouse.move(900 + Math.random() * 20, 300);

const SUMMARY = {
  type: 'standard',
  title: 'Jane Austen',
  description: 'English novelist (1775–1817)',
  extract:
    'Jane Austen was an English novelist known primarily for her six novels, which implicitly interpret, critique, and comment upon the British landed gentry at the end of the 18th century. Her plots often explore the dependence of women on marriage for the pursuit of favourable social standing and economic security.',
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Jane_Austen' } },
};

for (const theme of THEMES)
  test(`read-aloud + lookup ${theme}`, async ({ page, context }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(installFakeSpeech);
    await page.route(/wikipedia\.org/, (route) => {
      const url = decodeURIComponent(route.request().url());
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
      if (/summary\/fortune\?/i.test(url)) return json({ type: 'disambiguation', title: 'Fortune' });
      if (url.includes('opensearch'))
        return json(['Fortune', ['Fortune', 'Fortuna', 'Fortune (magazine)', 'Fortune (novel)', 'Wheel of Fortune'], ['', 'Roman goddess of luck', 'American business magazine', '1927 novel', 'Symbol of the capricious nature of fate']]);
      return json(SUMMARY);
    });
    const shot = async (name: string) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
    };
    await page.goto('/');
    await page.waitForFunction(() => (globalThis as any).__QUIRE__);
    await page.evaluate((t) => (globalThis as any).__QUIRE__.settings.set('theme', t), theme);

    // EPUB: speaking, a word lit
    await open(page, 'reflow/epub3.epub');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+Shift+S');
    await expect(page.getByTestId('speech-player')).toBeVisible();
    await page.evaluate('globalThis.__fakeSpeech.end()');
    await words(page, 7);
    await wake(page);
    await shot('speech-epub');
    // chrome faded: the player whispers
    await page.mouse.move(1000, 420);
    await expect(page.locator('html')).toHaveAttribute('data-chrome-hidden', '', { timeout: 8000 });
    await page.waitForTimeout(400);
    await shot('speech-epub-quiet');
    await wake(page);
    await page.getByTestId('speech-voice').click();
    await expect(page.getByTestId('voice-picker')).toBeVisible();
    await shot('speech-voices');
    await page.keyboard.press('Escape');
    await page.getByTestId('speech-speed').click();
    await expect(page.getByTestId('speed-control')).toBeVisible();
    await shot('speech-speed');
    await page.keyboard.press('Escape');
    await page.getByTestId('speech-stop').click();

    // lookup: dictionary, Wikipedia summary, disambiguation, offline
    await page.keyboard.press('Home');
    await page.waitForTimeout(400);
    await selectWord(page, 'good');
    await page.keyboard.press('d');
    await expect(page.getByTestId('lookup-dictionary')).toBeVisible();
    await shot('lookup-dictionary');
    await page.getByTestId('lookup-popover').getByRole('tab', { name: 'Wikipedia' }).click();
    await expect(page.getByTestId('lookup-wiki-summary')).toBeVisible();
    await shot('lookup-wikipedia');
    await page.keyboard.press('Escape');
    await selectWord(page, 'fortune');
    await page.evaluate(() => (globalThis as any).__QUIRE__.commands.execute('lookup.wikipedia'));
    await expect(page.getByTestId('lookup-wiki-choices')).toBeVisible();
    await shot('lookup-disambiguation');
    await page.keyboard.press('Escape');
    await selectWord(page, 'truth');
    await page.keyboard.press('d');
    await expect(page.getByTestId('lookup-popover')).toBeVisible();
    await context.setOffline(true);
    await page.getByTestId('lookup-popover').getByRole('tab', { name: 'Wikipedia' }).click();
    await expect(page.getByTestId('lookup-wiki-error')).toBeVisible();
    await shot('lookup-offline');
    await context.setOffline(false);
    await page.keyboard.press('Escape');
    await close(page);

    // PDF: speaking, a word lit
    await open(page, 'pdf/text.pdf');
    await page.keyboard.press('Control+Shift+S');
    await expect(page.getByTestId('speech-player')).toBeVisible();
    await page.evaluate('globalThis.__fakeSpeech.end()');
    await words(page, 5);
    await wake(page);
    await shot('speech-pdf');
    await page.getByTestId('speech-stop').click();
    await close(page);

    // settings
    await page.keyboard.press('Control+,');
    await page.locator('[data-section="reading"]').click();
    await page.getByTestId('settings-voice').scrollIntoViewIfNeeded();
    await shot('speech-settings');
  });
