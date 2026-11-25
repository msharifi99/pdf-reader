// Copies the pdf.js runtime data (cMaps, standard fonts, wasm decoders, ICC profiles) into public/pdfjs
// so the app serves them locally (offline). Re-run after upgrading pdfjs-dist.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const src = 'node_modules/pdfjs-dist';
rmSync('public/pdfjs', { recursive: true, force: true });
mkdirSync('public/pdfjs', { recursive: true });
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) cpSync(`${src}/${d}`, `public/pdfjs/${d}`, { recursive: true });

// Form-script sandbox, patched so a Calculate script sees the field's current value in event.value (as in Acrobat)
// instead of null; sheets that let users override a computed field depend on it. (\\n: the code is an embedded string.)
const find = 'event.value = null;\\n      const target = this.#objects[targetId];\\n      let savedValue = FieldInternals.getComputedValue(target);';
const sandbox = readFileSync(`${src}/build/pdf.sandbox.mjs`, 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
if (sandbox.split(find).length !== 2) throw new Error('pdf.sandbox.mjs changed: update the Calculate event.value patch in scripts/pdfjs-assets.mjs');
writeFileSync('public/pdfjs/pdf.sandbox.mjs', sandbox.replace(find, find.replace('event.value = null;\\n      ', '') + '\\n      event.value = savedValue ?? null;'));
