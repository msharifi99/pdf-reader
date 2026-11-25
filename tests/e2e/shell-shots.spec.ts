import { test, expect, type Page } from '@playwright/test';

// Shell + cross-screen screenshots for the design review (T16): every theme (and a custom one),
// three window sizes, and Windows high contrast. Run on demand: SHOTS=1 npx playwright test shell-shots
test.skip(!process.env.SHOTS, 'screenshots only on demand (SHOTS=1)');

const OUT = process.env.SHOTS_DIR ?? 'docs/design';
const THEMES = (process.env.SHOTS_THEMES ?? 'dark,solarized-light,light,sepia,oled,custom').split(',');
const SIZES = (process.env.SHOTS_SIZES ?? '1280x800,1920x1080,900x600').split(',').map((s) => s.split('x').map(Number) as [number, number]);
const CUSTOM = { id: 'custom-dusk', name: 'Dusk', bg: '#20262e', text: '#d8dee9', accent: '#88c0d0', link: '#8fbcbb', selection: '#3b4252' };

async function boot(page: Page, theme: string) {
  await page.goto('/');
  await expect(page.getByTestId('library-view')).toBeVisible();
  await page.evaluate(
    ([t, c]) => {
      const s = (globalThis as any).__QUIRE__.settings;
      if (t === 'custom') s.set('customThemes', [c]);
      s.set('theme', t === 'custom' ? (c as { id: string }).id : t);
      s.set('library', { view: 'grid', sort: 'recent', reverse: false });
    },
    [theme, CUSTOM] as const,
  );
  await page.locator('body').click({ position: { x: 8, y: 300 } });
  await page.waitForTimeout(500);
}
async function open(page: Page, path: string) {
  await page.evaluate((p) => (globalThis as any).__QUIRE__.openDocument(p), path);
  await expect(page.getByTestId('reader-view')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
  await page.waitForTimeout(700);
}
const close = async (page: Page) => {
  await page.evaluate(() => (globalThis as any).__QUIRE__.closeBook());
  await expect(page.getByTestId('reader-view')).toHaveCount(0);
};

function run(theme: string, w: number, h: number, forced = false) {
  test(`shell ${theme} ${w}x${h}${forced ? ' forced-colors' : ''}`, async ({ page }) => {
    test.setTimeout(180_000);
    if (forced) await page.emulateMedia({ forcedColors: 'active' });
    await page.setViewportSize({ width: w, height: h });
    const tag = `${theme}${forced ? '-hc' : ''}-${w}x${h}`;
    const shot = async (name: string) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${OUT}/shell-${name}-${tag}.png` });
    };
    await boot(page, theme);
    await shot('library');

    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('palette')).toBeVisible();
    await page.keyboard.type('>theme');
    await shot('palette-commands');
    await page.keyboard.press('Escape');

    await page.keyboard.press('Shift+?');
    await expect(page.getByTestId('cheat-sheet')).toBeVisible();
    await shot('cheatsheet');
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('settings')).toBeVisible();
    for (const id of ['appearance', 'reading', 'typography', 'keyboard', 'library', 'data', 'about']) {
      await page.locator(`[data-section="${id}"]`).click();
      await shot(`settings-${id}`);
    }
    await page.locator('[data-section="appearance"]').click();
    await page.getByTestId('new-theme').click();
    await expect(page.getByTestId('theme-editor')).toBeVisible();
    await shot('theme-editor');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings')).toBeHidden();

    // the reader with its panels: the page gives way instead of being covered
    await open(page, 'reflow/epub3.epub');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    await page.mouse.move(w / 2, h / 2);
    await shot('reader-epub');
    await page.keyboard.press('t');
    await expect(page.getByTestId('toc')).toBeVisible();
    await page.waitForTimeout(500);
    await shot('reader-epub-toc');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (globalThis as any).__QUIRE__.commands.execute('annotate.togglePanel'));
    await expect(page.getByTestId('reader-panel')).toBeVisible();
    await page.waitForTimeout(600);
    await page.mouse.move(w / 2 - 50, h / 2);
    await shot('reader-epub-panel');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('#');
    await shot('palette-toc');
    await page.keyboard.press('Escape');
    await close(page);

    await open(page, 'pdf/text.pdf');
    await page.mouse.move(w / 2, h / 2);
    await shot('reader-pdf');
    await close(page);
  });
}

for (const theme of THEMES) for (const [w, h] of SIZES) run(theme, w, h);
for (const [w, h] of SIZES.slice(0, 1)) for (const theme of ['dark', 'solarized-light']) run(theme, w, h, true);

// Calm states: errors, the scanned-PDF offer, the empty library.
for (const theme of THEMES.slice(0, 2))
  test(`states ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const shot = (name: string) => page.waitForTimeout(400).then(() => page.screenshot({ path: `${OUT}/states-${name}-${theme}.png` }));
    await boot(page, theme);
    for (const [name, path] of [['corrupt', 'pdf/corrupt.pdf'], ['drm', 'reflow/drm.epub'], ['missing', 'pdf/missing.pdf'], ['unsupported', 'reflow/corrupt.fb2']]) {
      await page.evaluate((p) => (globalThis as any).__QUIRE__.openDocument(p).catch(() => {}), path);
      await expect(page.getByRole('dialog').or(page.getByRole('alertdialog')).first()).toBeVisible({ timeout: 15_000 });
      await shot(`error-${name}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    await open(page, 'pdf/scanned.pdf');
    await page.mouse.move(640, 400);
    await shot('scanned');
    await close(page);
  });
