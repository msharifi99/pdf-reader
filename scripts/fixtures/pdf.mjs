// Generates the PDF fixtures in public/fixtures/pdf: node scripts/fixtures/pdf.mjs
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFNumber, PDFDict } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const out = 'public/fixtures/pdf';
mkdirSync(out, { recursive: true });

// Tiny PNG (red-to-yellow gradient with a blue disc) so the image region is clearly coloured.
function png(w, h) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * 3;
      const disc = Math.hypot(x - w / 2, y - h / 2) < h / 3;
      raw[o] = disc ? 20 : 230;
      raw[o + 1] = disc ? 60 : Math.round((x / w) * 200);
      raw[o + 2] = disc ? 220 : 30;
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t, d) => {
    const b = Buffer.concat([Buffer.from(t), d]);
    const l = Buffer.alloc(4);
    l.writeUInt32BE(d.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(b));
    return Buffer.concat([l, b, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PARA = [
  'The lighthouse keeper climbed the spiral stair every evening, one hand on the cold iron rail,',
  'counting the steps the way other people count their blessings. By the time he reached the lamp',
  'room the sea had gone the colour of slate and the first gulls were settling on the gallery.',
  'He trimmed the wick, wiped the great lens with a soft cloth, and waited for the dark to be',
  'complete enough to deserve the light. Nothing about the work was dramatic; that was the point.',
];

async function textPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('Quire Test Document');
  doc.setAuthor('Quire Fixtures');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const img = await doc.embedPng(png(120, 80));
  const ctx = doc.context;
  const pages = [];
  for (let i = 0; i < 12; i++) {
    const landscape = i === 2; // page 3 is landscape: exercises per-page size correction
    const p = doc.addPage(landscape ? [792, 612] : [612, 792]);
    pages.push(p);
    const { height } = p.getSize();
    p.drawText(`Chapter ${i + 1}`, { x: 72, y: height - 90, size: 28, font: bold });
    p.drawText(`Marker-${i + 1}`, { x: 72, y: height - 120, size: 12, font: bold });
    let y = height - 160;
    // "lighthouse keeper" stays only on pages 2, 5 and 7 (plus one extra line on page 5): 4 hits in total
    for (const l of PARA) {
      p.drawText([1, 4, 6].includes(i) ? l : l.replace('lighthouse keeper', 'harbour pilot'), { x: 72, y, size: 12, font });
      y -= 18;
    }
    if (i === 4) {
      p.drawText('A second lighthouse keeper appears here.', { x: 72, y: y - 10, size: 12, font });
      y -= 28;
    }
    p.drawText(`Quire phrase page ${i + 1}`, { x: 72, y: y - 20, size: 14, font });
    if (i === 0) {
      p.drawImage(img, { x: 72, y: 380, width: 240, height: 160 });
      p.drawText('Go to page five', { x: 72, y: 340, size: 12, font, color: rgb(0, 0, 0.8) });
      p.drawText('External link', { x: 72, y: 310, size: 12, font, color: rgb(0, 0, 0.8) });
    }
    if (i === 1) {
      p.drawText('Name:', { x: 72, y: 330, size: 12, font });
      const tf = doc.getForm().createTextField('name');
      tf.setText('Ada');
      tf.addToPage(p, { x: 120, y: 322, width: 180, height: 22 });
    }
  }
  const link = (rect, action) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], ...action }));
  pages[0].node.set(
    PDFName.of('Annots'),
    ctx.obj([
      link([72, 336, 170, 354], { Dest: [pages[4].ref, 'XYZ', 72, 700, null] }),
      link([72, 306, 160, 324], { A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/quire') } }),
    ]),
  );
  const items = [
    { t: 'Part one', p: 0, kids: [{ t: 'Opening', p: 0 }, { t: 'The stair', p: 1 }] },
    { t: 'Part two', p: 4, kids: [{ t: 'Landscape page', p: 2 }, { t: 'The lamp', p: 4 }] },
    { t: 'Epilogue', p: 11, kids: [] },
  ];
  const rootRef = ctx.nextRef();
  const build = (list, parent) => {
    const refs = list.map(() => ctx.nextRef());
    list.forEach((it, k) => {
      const d = ctx.obj({ Title: PDFString.of(it.t), Parent: parent, Dest: [pages[it.p].ref, 'XYZ', null, null, null] });
      if (k > 0) d.set(PDFName.of('Prev'), refs[k - 1]);
      if (k < list.length - 1) d.set(PDFName.of('Next'), refs[k + 1]);
      if (it.kids?.length) {
        const kr = build(it.kids, refs[k]);
        d.set(PDFName.of('First'), kr[0]);
        d.set(PDFName.of('Last'), kr[kr.length - 1]);
        d.set(PDFName.of('Count'), PDFNumber.of(it.kids.length));
      }
      ctx.assign(refs[k], d);
    });
    return refs;
  };
  const top = build(items, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[top.length - 1], Count: items.length }));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  // page labels: i, ii, 1, 2, ...
  doc.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Nums: [0, { S: 'r' }, 2, { S: 'D', St: 1 }] }));
  return doc.save();
}

async function bigPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('Quire Big Test Document');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2000; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Page ${i + 1}`, { x: 72, y: 700, size: 48, font });
    p.drawText('Synthetic page for scrolling tests.', { x: 72, y: 650, size: 14, font });
  }
  return doc.save();
}

// Hand-rolled standard security handler (V2/R3, RC4-128) PDF; user password "quire".
function encryptedPdf() {
  const md5 = (...b) => createHash('md5').update(Buffer.concat(b)).digest();
  const rc4 = (key, data) => {
    const s = Array.from({ length: 256 }, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + s[i] + key[i % key.length]) & 255;
      [s[i], s[j]] = [s[j], s[i]];
    }
    const o = Buffer.alloc(data.length);
    let a = 0;
    let b = 0;
    for (let k = 0; k < data.length; k++) {
      a = (a + 1) & 255;
      b = (b + s[a]) & 255;
      [s[a], s[b]] = [s[b], s[a]];
      o[k] = data[k] ^ s[(s[a] + s[b]) & 255];
    }
    return o;
  };
  const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
  const pad = (pw) => Buffer.concat([Buffer.from(pw), PAD]).subarray(0, 32);
  const id = md5(Buffer.from('quire-encrypted'));
  const P = -4;
  const Pb = Buffer.alloc(4);
  Pb.writeInt32LE(P);
  let h = md5(pad('owner'));
  for (let i = 0; i < 50; i++) h = md5(h);
  const okey = h.subarray(0, 16);
  let O = rc4(okey, pad('quire'));
  for (let i = 1; i <= 19; i++) O = rc4(Buffer.from(okey.map((b) => b ^ i)), O);
  let k = md5(pad('quire'), O, Pb, id);
  for (let i = 0; i < 50; i++) k = md5(k.subarray(0, 16));
  const key = k.subarray(0, 16);
  let U = rc4(key, md5(PAD, id));
  for (let i = 1; i <= 19; i++) U = rc4(Buffer.from(key.map((b) => b ^ i)), U);
  U = Buffer.concat([U, Buffer.alloc(16)]);
  const objKey = (n) => md5(key, Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0])).subarray(0, 16);
  const hex = (b) => '<' + b.toString('hex') + '>';
  const objs = [];
  const add = (n, body) => objs.push([n, Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')]);
  const stream = (n, text) => {
    const c = rc4(objKey(n), Buffer.from(`BT /F1 24 Tf 72 700 Td (${text}) Tj ET`));
    add(n, Buffer.concat([Buffer.from(`<< /Length ${c.length} >>\nstream\n`), c, Buffer.from('\nendstream')]));
  };
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');
  add(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>');
  stream(4, 'Secret page one');
  add(5, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>');
  stream(6, 'Secret page two');
  add(7, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  add(8, `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${P} /O ${hex(O)} /U ${hex(U)} >>`);
  let buf = Buffer.from('%PDF-1.6\n');
  const offs = {};
  for (const [n, body] of objs) {
    offs[n] = buf.length;
    buf = Buffer.concat([buf, Buffer.from(`${n} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
  }
  const xref = buf.length;
  let x = 'xref\n0 9\n0000000000 65535 f \n';
  for (let n = 1; n <= 8; n++) x += String(offs[n]).padStart(10, '0') + ' 00000 n \n';
  x += `trailer\n<< /Size 9 /Root 1 0 R /Encrypt 8 0 R /ID [${hex(id)} ${hex(id)}] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.concat([buf, Buffer.from(x)]);
}

/**
 * AcroForm driven by JavaScript (exercises the scripting sandbox):
 * - total = a + b, unless the user typed an override starting with "!" (Calculate sees the current value, as in Acrobat);
 * - box "p" cycles none -> p -> p+e -> none from its Mouse Up script; "level" counts the ticked boxes.
 */
async function formPdf() {
  const doc = await PDFDocument.create();
  const p = doc.addPage([612, 792]);
  const form = doc.getForm();
  const ctx = doc.context;
  const field = (name, y, v) => {
    const tf = form.createTextField(name);
    if (v) tf.setText(v);
    tf.addToPage(p, { x: 120, y, width: 120, height: 22 });
    return tf;
  };
  const js = (code) => ({ S: 'JavaScript', JS: PDFString.of(code) });
  field('a', 700, '2');
  field('b', 660, '3');
  const total = field('total', 620);
  total.acroField.dict.set(PDFName.of('AA'), ctx.obj({ C: js(
    "if (String(event.value).charAt(0) !== '!') event.value = Number(this.getField('a').value) + Number(this.getField('b').value);",
  ) }));
  const box = (name, x) => {
    const cb = form.createCheckBox(name);
    cb.addToPage(p, { x, y: 580, width: 16, height: 16 });
    return cb;
  };
  const prof = box('p', 120);
  box('e', 160);
  prof.acroField.getWidgets()[0].dict.set(PDFName.of('AA'), ctx.obj({ U: js(
    "var p = this.getField('p'), e = this.getField('e');" +
      ' if (!p.isBoxChecked(0)) { if (!e.isBoxChecked(0)) { p.checkThisBox(0, true); e.checkThisBox(0, true); } else e.checkThisBox(0, false); }',
  ) }));
  const level = field('level', 540);
  level.acroField.dict.set(PDFName.of('AA'), ctx.obj({ C: js(
    "event.value = String((this.getField('p').isBoxChecked(0) ? 1 : 0) + (this.getField('e').isBoxChecked(0) ? 1 : 0));",
  ) }));
  form.acroForm.dict.set(PDFName.of('CO'), ctx.obj([total.acroField.ref, level.acroField.ref]));
  return doc.save({ useObjectStreams: false });
}

writeFileSync(`${out}/form.pdf`, await formPdf());
writeFileSync(`${out}/text.pdf`, await textPdf());
writeFileSync(`${out}/big.pdf`, await bigPdf());
writeFileSync(`${out}/encrypted.pdf`, encryptedPdf());
writeFileSync(
  `${out}/corrupt.pdf`,
  Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R'), Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 255))]),
);
console.log('pdf fixtures written');
