// Minimal valid MOBI 6 writer for fixtures: PalmDOC (uncompressed) + MOBI header + EXTH, no images,
// no INDX. foliate-js splits sections at <mbp:pagebreak/>, builds the TOC from the guide's "toc"
// reference page and resolves `filepos` byte offsets, so those offsets are computed exactly here.
//
// What this does NOT produce: AZW3/KF8 (needs FDST, skeleton/fragment/NCX INDX tables with TAGX
// and CNCX records), compression (PalmDOC/HUFF-CDIC) and image records.

const ascii = (s) => s.replace(/[^\x00-\x7f]/g, (c) => `&#${c.codePointAt(0)};`);
const u32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u16 = (n) => Buffer.from([(n >>> 8) & 255, n & 255]);

/** @param {{title: string, author: string, chapters: Array<{title: string, paras: string[]}>, language?: number, encryption?: number}} o */
export function buildMobi({ title, author, chapters, language = 9, encryption = 0 }) {
  const PAGEBREAK = '<mbp:pagebreak/>';
  const pad = (n) => String(n).padStart(10, '0');
  let html =
    `<html><head><guide><reference type="toc" title="Contents" filepos=${pad(0)} /><reference type="text" title="Start" filepos=${pad(0)} /></guide></head><body>` +
    `<h1>Contents</h1>` +
    chapters.map((c, i) => `<p><a filepos=${pad(i)}>${ascii(c.title)}</a></p>`).join('') +
    chapters
      .map((c, i) => `${PAGEBREAK}<h1 id="c${i}">${ascii(c.title)}</h1>${c.paras.map((p) => `<p>${ascii(p)}</p>`).join('')}`)
      .join('') +
    '</body></html>';

  // Pass 2: replace the placeholders with the byte offset of each chapter's <h1> (width is fixed).
  const starts = [];
  for (let i = 0; i < chapters.length; i++) starts.push(html.indexOf(`<h1 id="c${i}">`));
  html = html.replace(/<a filepos=0{9}(\d)>/g, (_, i) => `<a filepos=${pad(starts[+i])}>`);
  const tocPos = html.indexOf('<h1>Contents</h1>');
  html = html.replace(`<reference type="toc" title="Contents" filepos=${pad(0)} />`, `<reference type="toc" title="Contents" filepos=${pad(tocPos)} />`);
  html = html.replace(`<reference type="text" title="Start" filepos=${pad(0)} />`, `<reference type="text" title="Start" filepos=${pad(starts[0])} />`);

  const text = Buffer.from(html, 'latin1');
  const RECORD = 4096;
  const textRecords = [];
  for (let i = 0; i < text.length; i += RECORD) textRecords.push(text.subarray(i, i + RECORD));

  // EXTH: author (100), title (503), language (524)
  const rec = (type, str) => {
    const data = Buffer.from(str, 'utf8');
    return Buffer.concat([u32(type), u32(8 + data.length), data]);
  };
  const exthBody = Buffer.concat([rec(100, author), rec(503, title), rec(524, 'en')]);
  let exthLen = 12 + exthBody.length;
  const exthPad = (4 - (exthLen % 4)) % 4;
  const exth = Buffer.concat([Buffer.from('EXTH'), u32(exthLen + exthPad), u32(3), exthBody, Buffer.alloc(exthPad)]);
  exthLen += exthPad;

  const HEADER_LEN = 232;
  const fullNameOffset = 16 + HEADER_LEN + exthLen;
  const name = Buffer.from(title, 'utf8');
  const rec0 = Buffer.alloc(16 + HEADER_LEN, 0);
  rec0.writeUInt16BE(1, 0); // no compression
  rec0.writeUInt32BE(text.length, 4);
  rec0.writeUInt16BE(textRecords.length, 8);
  rec0.writeUInt16BE(RECORD, 10);
  rec0.writeUInt16BE(encryption, 12); // PalmDOC encryption: 0 none, 1/2 Mobipocket DRM
  rec0.write('MOBI', 16, 'latin1');
  rec0.writeUInt32BE(HEADER_LEN, 20);
  rec0.writeUInt32BE(2, 24); // MOBI book
  rec0.writeUInt32BE(65001, 28); // UTF-8
  rec0.writeUInt32BE(0x51756972, 32); // uid
  rec0.writeUInt32BE(6, 36); // version
  rec0.fill(0xff, 40, 80); // unused index records
  rec0.writeUInt32BE(textRecords.length + 1, 80); // first non-book record
  rec0.writeUInt32BE(fullNameOffset, 84);
  rec0.writeUInt32BE(name.length, 88);
  rec0[95] = language; // locale language (9 = English)
  rec0.writeUInt32BE(6, 104); // min version
  rec0.writeUInt32BE(textRecords.length + 1, 108); // first image record (none)
  rec0.writeUInt32BE(0xffffffff, 112); // huffcdic
  rec0.writeUInt32BE(0x40, 128); // EXTH present
  rec0.writeUInt32BE(0xffffffff, 244); // INDX: none
  const record0 = Buffer.concat([rec0, exth, name, Buffer.alloc(2)]);

  const records = [record0, ...textRecords, Buffer.from([0xe9, 0x8e, 0x0d, 0x0a])];
  const listStart = 78;
  let offset = listStart + records.length * 8 + 2;
  const list = [];
  records.forEach((r, i) => {
    list.push(Buffer.concat([u32(offset), Buffer.from([0, 0, 0, i & 255])]));
    offset += r.length;
  });
  const pdb = Buffer.alloc(78, 0);
  pdb.write(title.replace(/\W+/g, '_').slice(0, 31), 0, 'latin1');
  pdb.writeUInt32BE(3600000000, 36); // created
  pdb.writeUInt32BE(3600000000, 40);
  pdb.write('BOOK', 60, 'latin1');
  pdb.write('MOBI', 64, 'latin1');
  pdb.writeUInt32BE(2 * records.length - 1, 68);
  pdb.writeUInt16BE(records.length, 76);
  return Buffer.concat([pdb, ...list, Buffer.alloc(2), ...records]);
}
