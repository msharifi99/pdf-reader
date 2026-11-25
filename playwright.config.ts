import { defineConfig, devices } from '@playwright/test';

// E2E runs the production build in fake-core mode (no __TAURI_INTERNALS__ in plain Chromium).
// QUIRE_E2E_PORT builds into its own dist folder so two runs (two agents) never share a server.
const port = Number(process.env.QUIRE_E2E_PORT ?? 4173);
const own = process.env.QUIRE_E2E_PORT ? ` --outDir dist-e2e-${port}` : '';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite build${own} && npx vite preview${own} --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI && !process.env.QUIRE_E2E_PORT,
    timeout: 180_000,
  },
});
