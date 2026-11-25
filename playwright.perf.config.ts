import { defineConfig, devices } from '@playwright/test';

// `npm run perf` (web layer): timings against the production build, one worker so nothing competes for the CPU.
const port = 4177;
export default defineConfig({
  testDir: 'tests/perf',
  testMatch: '**/*.perf.ts',
  workers: 1,
  reporter: 'list',
  timeout: 600_000,
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `npx vite build --outDir dist-perf && npx vite preview --outDir dist-perf --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
