// Renders the e-ink mockups, the launcher icons and the UI icon PNGs.
// Run from the repo root:  node android-eink/docs/mockups/src/render.mjs && python -I android-eink/docs/mockups/src/quantize.py
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..');
const iconDir = path.resolve(here, '../../icon');
fs.mkdirSync(path.join(iconDir, 'ui'), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 1100 }, deviceScaleFactor: 1 });

// 1. mockups
await page.goto(pathToFileURL(path.join(here, 'mockups.html')).href);
await page.waitForSelector('body[data-ready="1"]');
await page.evaluate(() => document.fonts.ready);
for (const id of ['library-grid', 'reader-chrome', 'contents', 'typography', 'highlights', 'settings']) {
  await page.locator('#' + id).screenshot({ path: path.join(out, `${id}.png`) });
}

// 2. launcher icon (grayscale variant of src-tauri / docs/design/app-icon.svg: flat tile, no gradient, no shadow)
const launcher = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}">
  <rect x="18" y="18" width="220" height="220" rx="54" fill="#aaaaaa" stroke="#000" stroke-width="${size <= 48 ? 8 : 6}"/>
  <g transform="translate(-7 -8)" fill="none" stroke="#000" stroke-linejoin="miter">
    <path d="M78 74H136A38 38 0 0 1 174 112V170H116A38 38 0 0 1 78 132Z" stroke-width="24"/>
    <path d="M104 100H130A18 18 0 0 1 148 118V144H122A18 18 0 0 1 104 126Z" stroke-width="${size <= 48 ? 13 : 11}"/>
    <path d="M166 162L198 194" stroke-width="24"/>
  </g></svg>`;
for (const [bucket, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144]]) {
  await page.setContent(`<body style="margin:0;background:transparent">${launcher(size)}</body>`);
  await page.locator('svg').screenshot({ path: path.join(iconDir, `ic_launcher-${bucket}-${size}.png`), omitBackground: true });
}
fs.writeFileSync(path.join(iconDir, 'ic_launcher.svg'), launcher(256));

// 3. UI icons, 32 px black on transparent (drawable-nodpi), from icons.js
await page.goto(pathToFileURL(path.join(here, 'mockups.html')).href);
const names = await page.evaluate(() => Object.keys(window.ICONS));
for (const n of names) {
  const svg = await page.evaluate(k => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="display:block;color:#000">${window.ICONS[k]}</svg>`, n);
  const p2 = await browser.newPage({ deviceScaleFactor: 1 });
  await p2.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
  const file = 'ic_' + n.replace(/[A-Z]/g, c => '_' + c.toLowerCase()) + '.png';
  await p2.locator('svg').screenshot({ path: path.join(iconDir, 'ui', file), omitBackground: true });
  await p2.close();
}
await browser.close();
console.log('rendered', names.length, 'icons');
