// Generates the comic fixtures in public/fixtures/comic: node scripts/fixtures/comic.mjs
// Pages are drawn in headless Chromium (Playwright is already a devDependency), archives are
// written with zip.js, and the RAR ones with WinRAR's Rar.exe (skipped, with a warning, when missing).
import { chromium } from '@playwright/test';
import { BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter, configure } from '@zip.js/zip.js';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

configure({ useWebWorkers: false });
const out = 'public/fixtures/comic';
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'images'), { recursive: true });

const W = 640;
const H = 960;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');

/** Draws one page and returns its encoded bytes. */
async function draw({ w = W, h = H, n, label, type = 'image/png', quality = 0.8 }) {
  const b64 = await page.evaluate(
    ([w, h, n, label, type, quality]) => {
      const c = document.getElementById('c');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      const hue = (n * 47) % 360;
      g.fillStyle = '#f3eee0'; // paper
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#1a1a1a';
      g.lineWidth = 8;
      g.strokeRect(24, 24, w - 48, h - 48);
      const panels = w > h ? [[40, 40, w / 2 - 60, h - 80], [w / 2 + 20, 40, w / 2 - 60, h - 80]] : [[40, 40, w - 80, h * 0.5 - 60], [40, h * 0.5 + 10, w / 2 - 50, h * 0.5 - 50], [w / 2 + 10, h * 0.5 + 10, w / 2 - 50, h * 0.5 - 50]];
      panels.forEach(([x, y, pw, ph], i) => {
        g.fillStyle = `hsl(${(hue + i * 40) % 360} 60% 72%)`;
        g.fillRect(x, y, pw, ph);
        g.strokeRect(x, y, pw, ph);
      });
      g.fillStyle = '#1a1a1a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold ${Math.min(w, h) * 0.32}px sans-serif`;
      const [x, y, pw, ph] = panels[0];
      g.fillText(String(n), x + pw / 2, y + ph / 2);
      g.font = '28px sans-serif';
      g.fillText(label, w / 2, h - 52);
      return c.toDataURL(type, quality).split(',')[1];
    },
    [w, h, n, label, type, quality],
  );
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

const svgPage = (n) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#f3eee0"/><rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="#1a1a1a" stroke-width="8"/><circle cx="${W / 2}" cy="${H / 2}" r="180" fill="hsl(${n * 47} 60% 72%)" stroke="#1a1a1a" stroke-width="8"/><text x="${W / 2}" y="${H / 2 + 70}" font-size="200" font-weight="bold" font-family="sans-serif" text-anchor="middle" fill="#1a1a1a">${n}</text></svg>`,
  );

async function zip(name, files) {
  const zw = new ZipWriter(new Uint8ArrayWriter());
  for (const [path, data] of files) await zw.add(path, new Uint8ArrayReader(data), { level: 1 });
  writeFileSync(join(out, name), await zw.close());
}

const text = (s) => new TextEncoder().encode(s);

// ---- comic.cbz: 10 pages (page 6 is a double-width spread), ComicInfo, junk entries --------------
const comic = [];
for (let i = 1; i <= 10; i++) {
  const ext = i === 4 ? 'jpg' : i === 5 ? 'webp' : 'png';
  const type = i === 4 ? 'image/jpeg' : i === 5 ? 'image/webp' : 'image/png';
  comic.push([`page${i}.${ext}`, await draw({ n: i, label: `PAGE ${i}`, type, w: i === 6 ? W * 2 : W })]);
}
const info = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo>
  <Title>Quire Test Comic</Title>
  <Series>Quire Tales</Series>
  <Number>1</Number>
  <Writer>A. Author</Writer>
  <Year>2026</Year>
  <PageCount>10</PageCount>
  <Pages>
    <Page Image="0" Type="FrontCover" Bookmark="Start"/>
    <Page Image="4" Bookmark="Chapter Two"/>
    <Page Image="8" Bookmark="Chapter Three"/>
  </Pages>
</ComicInfo>`;
const junk = [
  ['__MACOSX/._page1.png', text('junk')],
  ['Thumbs.db', text('junk')],
  ['notes.txt', text('not a page')],
];
// Lexicographic order on purpose (page1, page10, page2, ...): the engine must sort naturally.
const lex = [...comic].sort((a, b) => (a[0] < b[0] ? -1 : 1));
await zip('comic.cbz', [...junk, ['ComicInfo.xml', text(info)], ...lex]);

// ---- manga-rtl.cbz --------------------------------------------------------------------------------
const manga = [];
for (let i = 1; i <= 6; i++) manga.push([`${String(i).padStart(2, '0')}.png`, await draw({ n: i, label: `RIGHT TO LEFT ${i}` })]);
await zip('manga-rtl.cbz', [['ComicInfo.xml', text('<ComicInfo><Title>Quire Manga</Title><Manga>YesAndRightToLeft</Manga></ComicInfo>')], ...manga]);

// ---- images/ folder ---------------------------------------------------------------------------------
const imgs = [
  ['01.png', await draw({ n: 1, label: 'IMAGE 1' })],
  ['02.jpg', await draw({ n: 2, label: 'IMAGE 2', type: 'image/jpeg' })],
  ['03.webp', await draw({ n: 3, label: 'IMAGE 3', type: 'image/webp' })],
  ['04.svg', svgPage(4)],
  ['10.png', await draw({ n: 10, label: 'IMAGE 10' })],
];
for (const [n, d] of imgs) writeFileSync(join(out, 'images', n), d);
writeFileSync(join(out, 'images', 'notes.txt'), 'ignored');
// The fake core's listImageFolder reads this (the real one is Rust).
writeFileSync(join(out, 'images', 'index.json'), JSON.stringify(imgs.map(([n]) => n)));

// ---- broken archives -------------------------------------------------------------------------------
let seed = 7;
const noise = Uint8Array.from({ length: 300 }, () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 255);
writeFileSync(join(out, 'corrupt.cbz'), Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), noise]));
await zip('empty.cbz', [['readme.txt', text('no pages here')]]);

await browser.close();

// ---- RAR (WinRAR) ----------------------------------------------------------------------------------
const rar = ['C:\\Program Files\\WinRAR\\Rar.exe', 'C:\\Program Files (x86)\\WinRAR\\Rar.exe'].find(existsSync);
if (!rar) console.warn('Rar.exe not found: skipped comic.cbr / comic-rar4.cbr / encrypted.cbr');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'quire-rar-'));
  for (const [n, d] of [...comic.slice(0, 3), ...comic.slice(5, 7)]) writeFileSync(join(tmp, n), d); // pages 1-3, 6, 7
  writeFileSync(join(tmp, 'ComicInfo.xml'), info);
  const run = (name, ...flags) => {
    const r = spawnSync(rar, ['a', '-idq', '-ep', '-m0', ...flags, join(process.cwd(), out, name), '*'], { cwd: tmp });
    if (r.status !== 0) console.warn(`rar ${name} failed`, r.stderr?.toString() || r.stdout?.toString());
  };
  run('comic.cbr', '-ma5');
  run('encrypted.cbr', '-ma5', '-pquire'); // password: quire
  rmSync(tmp, { recursive: true, force: true });
}
// RAR 7 can no longer write RAR4, so build a stored (method 0x30) RAR 1.5-4.x archive by hand.
function rar4(files) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const withCrc = (body) => {
    const h = Buffer.alloc(2 + body.length);
    h.writeUInt16LE(crc32(body) & 0xffff, 0);
    body.copy(h, 2);
    return h;
  };
  const parts = [Buffer.from('526172211a0700', 'hex')];
  const main = Buffer.alloc(11); // type, flags, size, reserved
  main[0] = 0x73;
  main.writeUInt16LE(13, 3);
  parts.push(withCrc(main));
  for (const [name, data] of files) {
    const nm = Buffer.from(name);
    const b = Buffer.alloc(30 + nm.length);
    b[0] = 0x74;
    b.writeUInt16LE(0x8000, 1);
    b.writeUInt16LE(32 + nm.length, 3);
    b.writeUInt32LE(data.length, 5); // packed
    b.writeUInt32LE(data.length, 9); // unpacked
    b[13] = 2; // host OS: Win32
    b.writeUInt32LE(crc32(data), 14);
    b.writeUInt32LE(0x5a210000, 18); // DOS time
    b[22] = 20; // unpack version
    b[23] = 0x30; // method: store
    b.writeUInt16LE(nm.length, 24);
    b.writeUInt32LE(0x20, 26); // attributes
    nm.copy(b, 30);
    parts.push(withCrc(b), Buffer.from(data));
  }
  parts.push(Buffer.from('c43d7b00400700', 'hex'));
  return Buffer.concat(parts);
}
writeFileSync(join(out, 'comic-rar4.cbr'), rar4([...comic.slice(0, 3), ...comic.slice(5, 7), ['ComicInfo.xml', text(info)]]));
console.log('comic fixtures written to', out);
