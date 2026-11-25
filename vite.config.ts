import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Tauri expects a fixed port; fail if it's taken.
export default defineConfig({
  plugins: [svelte()],
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'chrome110',
    sourcemap: true,
    // Engine harness pages (e.g. harness/pdf.html) are built too so Playwright can reach them; set QUIRE_NO_HARNESS=1 for release builds.
    rollupOptions: { input: { main: 'index.html', ...(process.env.QUIRE_NO_HARNESS ? {} : { 'harness-pdf': 'harness/pdf.html' }) } },
  },
  test: {
    environment: 'node',
    // UI unit tests opt in with `// @vitest-environment happy-dom`
    include: ['src/**/*.test.ts'],
  },
});
