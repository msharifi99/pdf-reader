// Range loading of a ~600 MB PDF against a server that mimics src-tauri/src/protocol.rs
// (16 MB response cap, 206 for a Range-less request on a big file, CORS headers).
import { test, expect } from './helpers/test';
import { createServer, type Server } from 'node:http';
import { createWriteStream, existsSync, renameSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { randomFillSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const PAGES = 2500;
const IMG = 240_000;
const FILE = join(tmpdir(), `quire-large2-${PAGES}-${IMG}.pdf`);
const MAX_CHUNK = 16 * 1024 * 1024;
const PORT = 4599;

async function generate(): Promise<void> {
  if (existsSync(FILE) && statSync(FILE).size > 500e6) return;
  const tmp = `${FILE}.part`;
  const out = createWriteStream(tmp);
  let pos = 0;
  const offs: number[] = [];
  const write = async (b: Buffer | string) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    pos += buf.length;
    if (!out.write(buf)) await once(out, 'drain');
  };
  const obj = async (n: number, body: string | Buffer[]) => {
    offs[n] = pos;
    await write(`${n} 0 obj\n`);
    if (typeof body === 'string') await write(body);
    else for (const p of body) await write(p);
    await write('\nendobj\n');
  };
  await write('%PDF-1.7\n');
  // Balanced page tree (25 per node), as real large PDFs have: a flat 2,500-kid /Pages makes pdf.js read every page dict.
  const G = Math.ceil(PAGES / 25);
  const first = 4 + G;
  await obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  await obj(2, `<< /Type /Pages /Kids [${Array.from({ length: G }, (_, g) => `${4 + g} 0 R`).join(' ')}] /Count ${PAGES} >>`);
  await obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let g = 0; g < G; g++) {
    const n = Math.min(25, PAGES - g * 25);
    await obj(4 + g, `<< /Type /Pages /Parent 2 0 R /Count ${n} /Kids [${Array.from({ length: n }, (_, i) => `${first + 3 * (g * 25 + i)} 0 R`).join(' ')}] >>`);
  }
  const img = Buffer.alloc(IMG);
  for (let k = 0; k < PAGES; k++) {
    const p = first + 3 * k;
    await obj(p, `<< /Type /Page /Parent ${4 + Math.floor(k / 25)} 0 R /MediaBox [0 0 612 792] /Contents ${p + 1} 0 R /Resources << /Font << /F1 3 0 R >> /XObject << /Im ${p + 2} 0 R >> >> >>`);
    const content = `q 200 0 0 200 72 400 cm /Im Do Q BT /F1 48 Tf 72 700 Td (Page ${k + 1}) Tj ET`;
    await obj(p + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    randomFillSync(img);
    await obj(p + 2, [Buffer.from(`<< /Type /XObject /Subtype /Image /Width 400 /Height 600 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${IMG} >>\nstream\n`), Buffer.from(img), Buffer.from('\nendstream')]);
  }
  const total = first + 3 * PAGES;
  const xref = pos;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) x += `${String(offs[n]).padStart(10, '0')} 00000 n \n`;
  await write(`${x}trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  out.end();
  await once(out, 'finish');
  renameSync(tmp, FILE);
}

let server: Server;
let bytesServed = 0;
let requests: string[] = [];

test.beforeAll(async () => {
  test.setTimeout(600_000);
  await generate();
  const size = statSync(FILE).size;
  const fd = openSync(FILE, 'r');
  server = createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, If-Range',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type',
      'Accept-Ranges': 'bytes',
    };
    if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
    const m = /^bytes=(\d*)-(\d*)$/.exec((req.headers.range ?? '').trim());
    let start = 0, end = size - 1, partial = false;
    if (m && (m[1] || m[2])) {
      if (!m[1]) start = Math.max(0, size - Number(m[2]));
      else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
      if (start >= size) return void res.writeHead(416, { ...cors, 'Content-Range': `bytes */${size}` }).end();
      partial = true;
    } else if (size > MAX_CHUNK) partial = true;
    end = Math.min(end, start + MAX_CHUNK - 1);
    if (!partial) end = size - 1;
    const body = Buffer.alloc(end - start + 1);
    readSync(fd, body, 0, body.length, start);
    bytesServed += body.length;
    requests.push(`${req.headers.range ?? '-'} -> ${start}-${end}`);
    res.writeHead(partial ? 206 : 200, { ...cors, 'Content-Type': 'application/pdf', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
    res.end(body);
  });
  server.listen(PORT);
  await once(server, 'listening');
  test.info().annotations.push({ type: 'file', description: `${FILE} ${(size / 1e6).toFixed(0)} MB` });
  process.on('exit', () => closeSync(fd));
});
test.afterAll(() => void server?.close());

test('600 MB PDF opens over capped range responses without downloading the file', async ({ page }) => {
  test.setTimeout(120_000);
  bytesServed = 0;
  requests = [];
  await page.goto('/harness/pdf.html');
  const url = `http://localhost:${PORT}/large.pdf`;
  const err = await page.evaluate((u) => (window as any).__h.open(u), url);
  if (err) console.log(JSON.stringify(err), requests.join(String.fromCharCode(10)));
  expect(err).toBeNull();
  await expect(page.locator('.q-page[data-page="0"][data-rendered="true"]')).toBeVisible();
  const t = await page.evaluate(() => (window as any).__h.timing);
  const served = bytesServed;
  console.log(`large.pdf: first page ${t.firstPaintMs.toFixed(0)} ms, ${(served / 1e6).toFixed(2)} MB served in ${requests.length} requests`);
  console.log(requests.slice(0, 40).join('\n'));
  expect(t.firstPaintMs).toBeLessThan(1500);
  expect(served).toBeLessThan(10e6);
  expect((await page.evaluate(() => (window as any).__h.handle.pageCount))).toBe(PAGES);

  await page.evaluate(() => (window as any).__h.engine.goTo({ kind: 'fixed', page: 1999, y: 0 }));
  await expect(page.locator('.q-page[data-page="1999"][data-rendered="true"] .textLayer')).toContainText('Page 2000');
  console.log(`after jump to 2000: ${(bytesServed / 1e6).toFixed(2)} MB served in ${requests.length} requests`);
  expect(bytesServed).toBeLessThan(0.2 * statSync(FILE).size);
});
