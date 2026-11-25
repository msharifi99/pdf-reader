// Copies libarchive.js's worker + WASM into public/libarchive so Vite serves them untouched and the
// worker finds libarchive.wasm next to itself (offline, works under `vite build` and Tauri).
// Re-run after upgrading libarchive.js.
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('public/libarchive', { recursive: true });
for (const f of ['worker-bundle.js', 'libarchive.wasm']) cpSync(`node_modules/libarchive.js/dist/${f}`, `public/libarchive/${f}`);
