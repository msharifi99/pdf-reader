// Copies the pdf.js runtime data (cMaps, standard fonts, wasm decoders, ICC profiles) into public/pdfjs
// so the app serves them locally (offline). Re-run after upgrading pdfjs-dist.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
const src = 'node_modules/pdfjs-dist';
rmSync('public/pdfjs', { recursive: true, force: true });
mkdirSync('public/pdfjs', { recursive: true });
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) cpSync(`${src}/${d}`, `public/pdfjs/${d}`, { recursive: true });
