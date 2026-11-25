import { type Page } from '@playwright/test';
import { test, expect } from './helpers/test';

// App shell (T5): palette, cheat-sheet, shortcuts editor, theme, overlays, chrome auto-hide. Fake core.

async function boot(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('library-view')).toBeVisible();
  // the keyboard dispatcher listens on window; make sure the page has focus
  await page.locator('body').click({ position: { x: 8, y: 300 } }); // the page gutter: the library is full of covers now
}

const palette = (page: Page) => page.getByTestId('palette');
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

test('Ctrl+K opens the palette and Enter runs the selected command', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  await expect(palette(page).getByRole('combobox')).toBeFocused();
  await page.keyboard.type('open settings');
  await expect(palette(page).getByRole('option').first()).toContainText('Open settings');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
  await expect(page.getByTestId('settings')).toBeVisible();
});

test('palette filters fuzzily and emphasises the matched characters', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('tglfs');
  const first = palette(page).getByRole('option').first();
  await expect(first).toContainText('Toggle fullscreen');
  await expect(first.locator('mark').first()).toBeVisible();
  await expect(palette(page).getByRole('option', { name: /Open settings/ })).toHaveCount(0);
  // `>` mode lists commands too; `#` without a book explains itself
  await page.keyboard.press('Control+a');
  await page.keyboard.type('#12');
  await expect(palette(page).getByRole('status')).toContainText('Open a book');
});

test('? opens the cheat-sheet with the active shortcuts', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Shift+?');
  const sheet = page.getByTestId('cheat-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Open settings');
  await sheet.getByRole('searchbox').fill('fullscreen');
  await expect(sheet).toContainText('Toggle fullscreen');
  await expect(sheet).not.toContainText('Open settings');
});

async function openKeyboardSettings(page: Page) {
  await page.keyboard.press('Control+,');
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.locator('[data-section="keyboard"]').click();
  await expect(page.getByTestId('shortcuts-editor')).toBeVisible();
}

test('rebinding a command in the editor makes the new key run it', async ({ page }) => {
  await boot(page);
  const before = await theme(page);
  await openKeyboardSettings(page);
  await page.getByRole('button', { name: 'Add a shortcut for Next theme' }).click();
  await page.keyboard.press('Control+Alt+j');
  const confirm = page.getByTestId('shortcut-confirm');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-command="theme.next"]')).toContainText('Alt');
  await page.keyboard.press('Escape'); // close settings
  await expect(page.getByTestId('settings')).toBeHidden();
  await page.keyboard.press('Control+Alt+j');
  await expect.poll(() => theme(page)).not.toBe(before);
});

test('a conflicting key offers Swap', async ({ page }) => {
  await boot(page);
  await openKeyboardSettings(page);
  await page.getByRole('button', { name: 'Add a shortcut for Next theme' }).click();
  await page.keyboard.press('Control+o'); // already "Open file"
  const confirm = page.getByTestId('shortcut-confirm');
  await expect(confirm).toContainText('Open file');
  await confirm.getByRole('button', { name: 'Swap' }).click();
  await expect(page.locator('[data-command="theme.next"]')).toContainText('O');
  await expect(page.locator('[data-command="app.openFile"]').locator('kbd')).toHaveCount(0);
});

test('choosing a theme in settings changes the tokens on <html>', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+,');
  await page.locator('[data-theme-card="solarized-light"]').click();
  await expect.poll(() => theme(page)).toBe('solarized-light');
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  expect(bg.toLowerCase()).toBe('#fdf6e3');

  // a custom theme from the editor becomes the active theme
  await page.getByTestId('new-theme').click();
  const editor = page.getByTestId('theme-editor');
  await editor.getByLabel('Name').fill('Night shore');
  await editor.locator('[data-colour="bg"]').click();
  await page.getByRole('dialog', { name: 'Background colour' }).getByRole('textbox').first().fill('#102030');
  await page.keyboard.press('Escape');
  await editor.getByRole('button', { name: 'Create theme' }).click();
  await expect.poll(() => theme(page)).toMatch(/^custom-/);
  await expect(page.locator('[data-theme-card^="custom-"]')).toContainText('Night shore');
});

test('Esc closes overlays top first, then leaves the reader', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (globalThis as any).__QUIRE__.openDocument('pdf/text.pdf'));
  await expect(page.getByTestId('reader-view')).toBeVisible();
  await page.keyboard.press('Control+,');
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings')).toBeHidden();
  await expect(page.getByTestId('reader-view')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('library-view')).toBeVisible();
});

test('reader chrome hides after 2 s idle and returns on mousemove', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (globalThis as any).__QUIRE__.openDocument('pdf/text.pdf'));
  await expect(page.getByTestId('reader-view')).toBeVisible();
  await page.mouse.move(640, 500);
  await page.mouse.move(660, 520);
  const hidden = () => page.evaluate(() => document.documentElement.hasAttribute('data-chrome-hidden'));
  expect(await hidden()).toBe(false);
  await page.waitForTimeout(1500);
  expect(await hidden()).toBe(false);
  await expect.poll(hidden, { timeout: 3000 }).toBe(true);
  await page.mouse.move(400, 300);
  await expect.poll(hidden).toBe(false);
  // never in the library
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2600);
  expect(await hidden()).toBe(false);
});
