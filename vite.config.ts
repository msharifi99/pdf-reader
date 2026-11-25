import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { foliatePaginator } from './src/lib/engines/reflow/vendor/vite-plugin';

// Release builds (`vite build --mode release`, run by `tauri build`; or QUIRE_NO_HARNESS=1) leave out the
// dev harness pages, the e2e fixtures (public/fixtures) and sourcemaps. Plain `vite build` keeps them for Playwright.
// (read from argv, not a config function, so vite.t8.config.ts can still mergeConfig() this object)
const release = process.argv.includes('release') || !!process.env.QUIRE_NO_HARNESS;
export default defineConfig({
  plugins: [
    svelte(),
    foliatePaginator(),
    {
      name: 'quire-strip-fixtures',
      apply: 'build' as const,
      closeBundle() {
        if (release) rmSync(resolve('dist/fixtures'), { recursive: true, force: true });
      },
    },
  ],
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
  // foliate-js stays unbundled in dev so the plugin above can swap its paginator
  optimizeDeps: { exclude: ['foliate-js'] },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'chrome110',
    sourcemap: !release,
    // Engine harness pages (e.g. harness/pdf.html) are built too so Playwright can reach them.
    rollupOptions: {
      input: {
        main: 'index.html',
        indexer: 'indexer.html',
        ...(release ? {} : { 'harness-pdf': 'harness/pdf.html', 'harness-reflow': 'harness/reflow.html', 'harness-comic': 'harness/comic.html', 'harness-indexing': 'harness/indexing.html' }),
      },
    },
  },
  test: {
    environment: 'node',
    // UI unit tests opt in with `// @vitest-environment happy-dom`
    include: ['src/**/*.test.ts'],
  },
});
