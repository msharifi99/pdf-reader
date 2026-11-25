import { test, expect } from './helpers/test';

test('app boots in fake-core mode and shows the version', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-version')).toHaveText(/^Quire \d+\.\d+\.\d+/);
});
