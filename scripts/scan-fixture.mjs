// Generates the OCR fixtures: src-tauri/tests/fixtures/scan.png (large clear text, for the Rust OCR test)
// and public/fixtures/pdf/scanned.pdf (an image-only PDF made from that PNG with pdf-lib).
// Text is drawn by headless Chromium, so no extra tooling is needed. Run: node scripts/scan-fixture.mjs
import { chromium } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';

const W = 1240, H = 1754; // A4 at 150 dpi
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const dataUrl = await page.evaluate(([w, h]) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#111'; g.textBaseline = 'top';
  g.font = 'bold 92px Arial, sans-serif';
  g.fillText('QUIRE READS SCANS', 90, 160);
  g.font = '56px Georgia, serif';
  g.fillText('The quick brown fox jumps over', 90, 420);
  g.fillText('the lazy dog near the riverbank.', 90, 500);
  return c.toDataURL('image/png');
}, [W, H]);
await browser.close();
const png = Buffer.from(dataUrl.split(',')[1], 'base64');
mkdirSync('src-tauri/tests/fixtures', { recursive: true });
writeFileSync('src-tauri/tests/fixtures/scan.png', png);

const pdf = await PDFDocument.create();
const img = await pdf.embedPng(png);
for (let i = 0; i < 2; i++) pdf.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 }); // A4, two identical pages
pdf.setTitle('Scanned fixture');
writeFileSync('public/fixtures/pdf/scanned.pdf', await pdf.save());
console.log('scan.png', png.length, 'bytes; scanned.pdf written');
