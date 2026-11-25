// Minimal valid AZW3 / KF8 writer for fixtures. Layout (all records uncompressed):
//   rec 0     PalmDOC + MOBI header (version 8) + EXTH
//   1..N      raw markup: for each section its skeleton, then its fragment(s)
//   N+1       FDST (one flow: the markup)
//   skel/frag/NCX INDX record sets (header record with TAGX, data record, optional CNCX)
//   last      EOF marker
// foliate-js resolves sections through the skeleton + fragment tables, links through `kindle:pos`
// ids and the TOC through the NCX index, so all three are produced here.
//
// Not produced: images/fonts/flows other than the markup, compression, guide/landmarks index,
// the combined MOBI 6 + KF8 ("combo") layout.

const u32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u16 = (n) => Buffer.from([(n >>> 8) & 255, n & 255]);
const pad4 = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);

/** foliate `getVarLen`: big-endian 7-bit groups; the LAST byte carries the high bit. */
function varlen(n) {
  const groups = [];
  do {
    groups.unshift(n & 0x7f);
    n = Math.floor(n / 128);
  } while (n > 0);
  groups[groups.length - 1] |= 0x80;
  return Buffer.from(groups);
}

const INDX_HEADER_LEN = 192;

/**
 * One index: header record (+TAGX), one data record, optional CNCX record.
 * @param {number[][]} tags       rows [tag, numValues, mask, endOfControlByte]
 * @param {{name: string, control: number, values: number[]}[]} entries   single control byte per entry
 * @param {Buffer|null} cncx
 */
function buildIndex(tags, entries, cncx) {
  const tagx = Buffer.concat([Buffer.from('TAGX'), u32(12 + tags.length * 4), u32(1), ...tags.map((t) => Buffer.from(t))]);
  const head = Buffer.alloc(INDX_HEADER_LEN);
  head.write('INDX', 0, 'latin1');
  head.writeUInt32BE(INDX_HEADER_LEN, 4);
  head.writeUInt32BE(1, 24); // one data record
  head.writeUInt32BE(65001, 28);
  head.writeUInt32BE(entries.length, 36);
  head.writeUInt32BE(cncx ? 1 : 0, 52);
  const headRecord = Buffer.concat([head, pad4(tagx)]);

  const bodies = entries.map((e) => Buffer.concat([Buffer.from([e.name.length]), Buffer.from(e.name, 'latin1'), Buffer.from([e.control]), ...e.values.map(varlen)]));
  const offsets = [];
  let at = INDX_HEADER_LEN;
  for (const b of bodies) {
    offsets.push(at);
    at += b.length;
  }
  const idxtStart = at + ((4 - (at % 4)) % 4);
  const dataHead = Buffer.alloc(INDX_HEADER_LEN);
  dataHead.write('INDX', 0, 'latin1');
  dataHead.writeUInt32BE(INDX_HEADER_LEN, 4);
  dataHead.writeUInt32BE(idxtStart, 20);
  dataHead.writeUInt32BE(entries.length, 24);
  dataHead.writeUInt32BE(65001, 28);
  const dataRecord = Buffer.concat([dataHead, ...bodies, Buffer.alloc(idxtStart - at), Buffer.from('IDXT'), ...offsets.map(u16)]);
  return [headRecord, dataRecord, ...(cncx ? [cncx] : [])];
}

/** CNCX record: [varlen length][utf-8] strings; returns the buffer and each string's key (byte offset). */
function buildCncx(strings) {
  const parts = [];
  const keys = [];
  let at = 0;
  for (const s of strings) {
    const data = Buffer.from(s, 'utf8');
    const lenBytes = varlen(data.length);
    keys.push(at);
    parts.push(lenBytes, data);
    at += lenBytes.length + data.length;
  }
  return { buffer: pad4(Buffer.concat(parts)), keys };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** @param {{title: string, author: string, chapters: Array<{title: string, paras: string[]}>, encryption?: number}} o */
export function buildAzw3({ title, author, chapters, encryption = 0 }) {
  // --- raw markup stream, with offsets -----------------------------------------------------
  const skeletons = [];
  const frags = [];
  let stream = Buffer.alloc(0);
  chapters.forEach((c, i) => {
    const head = Buffer.from(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(c.title)}</title></head><body aid="${i}">`, 'utf8');
    const tail = Buffer.from('</body></html>', 'utf8');
    const skeleton = Buffer.concat([head, tail]);
    const body = Buffer.from(`<h1 id="c${i}">${esc(c.title)}</h1>${c.paras.map((p) => `<p>${esc(p)}</p>`).join('')}`, 'utf8');
    const skelOffset = stream.length;
    skeletons.push({ offset: skelOffset, length: skeleton.length, insertAt: head.length });
    frags.push({ fid: i, offset: 0, length: body.length, selector: `<body aid="${i}">`, skel: i });
    stream = Buffer.concat([stream, skeleton, body]);
  });

  const RECORD = 4096;
  const textRecords = [];
  for (let i = 0; i < stream.length; i += RECORD) textRecords.push(stream.subarray(i, i + RECORD));
  const N = textRecords.length;

  const fdst = Buffer.concat([Buffer.from('FDST'), u32(12), u32(1), u32(0), u32(stream.length)]);

  // --- indexes -----------------------------------------------------------------------------
  const skelIndex = buildIndex(
    [[1, 1, 0x03, 0], [6, 2, 0x0c, 0], [0, 0, 0, 1]],
    skeletons.map((s, i) => ({ name: `SKEL${String(i).padStart(10, '0')}`, control: 0x05, values: [1, s.offset, s.length] })),
    null,
  );
  const selectors = buildCncx(frags.map((f) => f.selector));
  const fragIndex = buildIndex(
    [[2, 1, 0x01, 0], [3, 1, 0x02, 0], [4, 1, 0x04, 0], [6, 2, 0x08, 0], [0, 0, 0, 1]],
    frags.map((f, i) => ({
      name: String(skeletons[f.skel].offset + skeletons[f.skel].insertAt).padStart(10, '0'),
      control: 0x0d,
      values: [selectors.keys[i], f.fid, f.offset, f.length],
    })),
    selectors.buffer,
  );
  const labels = buildCncx(chapters.map((c) => c.title));
  const ncxIndex = buildIndex(
    [[1, 1, 0x01, 0], [2, 1, 0x02, 0], [3, 1, 0x04, 0], [4, 1, 0x08, 0], [6, 2, 0x10, 0], [0, 0, 0, 1]],
    chapters.map((_, i) => ({ name: String(i).padStart(4, '0'), control: 0x1f, values: [frags[i].offset, frags[i].length, labels.keys[i], 0, i, 0] })),
    labels.buffer,
  );

  // --- record 0 ---------------------------------------------------------------------------------
  const rec = (type, str) => {
    const data = Buffer.from(str, 'utf8');
    return Buffer.concat([u32(type), u32(8 + data.length), data]);
  };
  const exthBody = Buffer.concat([rec(100, author), rec(503, title), rec(524, 'en')]);
  const exthLen = 12 + exthBody.length;
  const exthPad = (4 - (exthLen % 4)) % 4;
  const exth = Buffer.concat([Buffer.from('EXTH'), u32(exthLen + exthPad), u32(3), exthBody, Buffer.alloc(exthPad)]);

  // record numbers
  const fdstRec = N + 1;
  const skelRec = fdstRec + 1;
  const fragRec = skelRec + skelIndex.length;
  const ncxRec = fragRec + fragIndex.length;
  const eofRec = ncxRec + ncxIndex.length;

  const HEADER_LEN = 248;
  const name = Buffer.from(title, 'utf8');
  const rec0 = Buffer.alloc(16 + HEADER_LEN, 0);
  rec0.writeUInt16BE(1, 0);
  rec0.writeUInt32BE(stream.length, 4);
  rec0.writeUInt16BE(N, 8);
  rec0.writeUInt16BE(RECORD, 10);
  rec0.writeUInt16BE(encryption, 12);
  rec0.write('MOBI', 16, 'latin1');
  rec0.writeUInt32BE(HEADER_LEN, 20);
  rec0.writeUInt32BE(2, 24);
  rec0.writeUInt32BE(65001, 28);
  rec0.writeUInt32BE(0x51756972, 32);
  rec0.writeUInt32BE(8, 36); // version 8 = KF8
  rec0.fill(0xff, 40, 80);
  rec0.writeUInt32BE(fdstRec, 80);
  rec0.writeUInt32BE(16 + HEADER_LEN + exth.length, 84); // full name offset
  rec0.writeUInt32BE(name.length, 88);
  rec0[95] = 9;
  rec0.writeUInt32BE(8, 104);
  rec0.writeUInt32BE(eofRec, 108); // first resource record (none)
  rec0.writeUInt32BE(0xffffffff, 112);
  rec0.writeUInt32BE(0x40, 128);
  rec0.writeUInt32BE(ncxRec, 244); // NCX index
  rec0.writeUInt32BE(fdstRec, 192); // KF8: FDST record
  rec0.writeUInt32BE(1, 196); // number of FDST entries
  rec0.writeUInt32BE(fragRec, 248);
  rec0.writeUInt32BE(skelRec, 252);
  rec0.writeUInt32BE(0xffffffff, 260); // no guide index
  const record0 = Buffer.concat([rec0, exth, name, Buffer.alloc(2)]);

  const records = [record0, ...textRecords, fdst, ...skelIndex, ...fragIndex, ...ncxIndex, Buffer.from([0xe9, 0x8e, 0x0d, 0x0a])];
  let offset = 78 + records.length * 8 + 2;
  const list = records.map((r, i) => {
    const e = Buffer.concat([u32(offset), Buffer.from([0, 0, 0, i & 255])]);
    offset += r.length;
    return e;
  });
  const pdb = Buffer.alloc(78, 0);
  pdb.write(title.replace(/\W+/g, '_').slice(0, 31), 0, 'latin1');
  pdb.writeUInt32BE(3600000000, 36);
  pdb.writeUInt32BE(3600000000, 40);
  pdb.write('BOOK', 60, 'latin1');
  pdb.write('MOBI', 64, 'latin1');
  pdb.writeUInt32BE(2 * records.length - 1, 68);
  pdb.writeUInt16BE(records.length, 76);
  return Buffer.concat([pdb, ...list, Buffer.alloc(2), ...records]);
}
