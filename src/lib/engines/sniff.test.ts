import { describe, expect, it } from 'vitest';
import { blobReader, engineKindFor, sniff, sniffBytes } from './sniff';

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? ascii(p) : p)));
const pad = (n: number) => new Array(n).fill(0);
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];

/** Minimal zip: local headers (name only) + central directory + EOCD. */
function zip(names: string[], firstData = ''): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  names.forEach((name, i) => {
    const offset = local.length;
    const data = i === 0 ? ascii(firstData) : [];
    local.push(...ascii('PK\x03\x04'), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0),
      ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(name.length), ...le16(0), ...ascii(name), ...data);
    central.push(...ascii('PK\x01\x02'), ...le16(20), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0),
      ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(name.length), ...le16(0), ...le16(0),
      ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...ascii(name));
  });
  const eocd = [...ascii('PK\x05\x06'), 0, 0, 0, 0, ...le16(names.length), ...le16(names.length),
    ...le32(central.length), ...le32(local.length), 0, 0];
  return new Uint8Array([...local, ...central, ...eocd]);
}

function palmdb(mobiVersion: number, magic = 'BOOKMOBI'): Uint8Array {
  const head = [...pad(60), ...ascii(magic), ...pad(8), 0, 1, ...be32(86), 0, 0, 0, 0]; // numRecords@76, record0 @86
  const rec0 = [...pad(16), ...ascii('MOBI'), ...be32(232), ...be32(2), ...be32(65001), ...be32(0), ...be32(mobiVersion)];
  return bytes(head, rec0, pad(64));
}

describe('sniffBytes', () => {
  it('detects PDF, also with leading junk', () => {
    expect(sniffBytes(bytes('%PDF-1.7\n')).format).toBe('pdf');
    expect(sniffBytes(bytes(pad(20), '%PDF-1.4')).format).toBe('pdf');
  });

  it('detects EPUB by the stored mimetype entry', () => {
    const z = zip(['mimetype', 'META-INF/container.xml'], 'application/epub+zip');
    expect(sniffBytes(z, z).format).toBe('epub');
  });

  it('detects EPUB from the central directory when mimetype is not first', () => {
    const z = zip(['META-INF/container.xml', 'OEBPS/content.opf']);
    expect(sniffBytes(z, z).format).toBe('epub');
  });

  it('detects CBZ (mostly images) and rejects other zips', () => {
    const cbz = zip(['001.jpg', '002.jpg', 'ComicInfo.xml']);
    expect(sniffBytes(cbz, cbz).format).toBe('cbz');
    const docx = zip(['[Content_Types].xml', 'word/document.xml']);
    expect(sniffBytes(docx, docx).format).toBeNull();
  });

  it('detects FBZ (zipped fb2)', () => {
    const z = zip(['book.fb2']);
    expect(sniffBytes(z, z).format).toBe('fbz');
  });

  it('detects RAR4 and RAR5 as cbr', () => {
    expect(sniffBytes(bytes('Rar!\x1a\x07\x00', pad(10))).format).toBe('cbr');
    expect(sniffBytes(bytes('Rar!\x1a\x07\x01\x00', pad(10))).format).toBe('cbr');
  });

  it('distinguishes MOBI from AZW3 (KF8) and ignores PalmDOC', () => {
    expect(sniffBytes(palmdb(6)).format).toBe('mobi');
    expect(sniffBytes(palmdb(8)).format).toBe('azw3');
    expect(sniffBytes(palmdb(6, 'TEXtREAd')).format).toBeNull();
  });

  it('detects FB2', () => {
    const fb2 = '<?xml version="1.0" encoding="utf-8"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">';
    expect(sniffBytes(bytes(fb2)).format).toBe('fb2');
  });

  it.each([
    ['png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pad(8))],
    ['jpeg', bytes([0xff, 0xd8, 0xff, 0xe0], pad(8))],
    ['gif', bytes('GIF89a', pad(8))],
    ['webp', bytes('RIFF', pad(4), 'WEBPVP8 ')],
    ['avif', bytes(pad(4), 'ftypavif', pad(8))],
    ['bmp', bytes('BM', pad(12), le32(40), pad(8))],
    ['tiff', bytes([0x49, 0x49, 0x2a, 0x00], pad(8))],
    ['svg', bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
  ])('detects %s images', (type, data) => {
    const r = sniffBytes(data);
    expect(r.format).toBe('image');
    expect(r.imageType).toBe(type);
  });

  it('returns null for unknown bytes', () => {
    expect(sniffBytes(bytes('hello world')).format).toBeNull();
    expect(sniffBytes(new Uint8Array()).format).toBeNull();
  });
});

describe('sniff (reader)', () => {
  it('reads head and tail of a large zip through a RangeReader', async () => {
    const cd = zip(['a.png', 'b.png']);
    const big = new Uint8Array(200_000);
    big.set(ascii('PK'), 0); // local header magic at the start
    big.set(cd, big.length - cd.length); // central directory + EOCD at the end
    const r = await sniff(blobReader(new Blob([big])));
    expect(r.format).toBe('cbz');
  });
});

describe('engineKindFor', () => {
  it('maps formats to engine families', () => {
    expect(engineKindFor('pdf')).toBe('pdf');
    expect(engineKindFor('epub')).toBe('reflow');
    expect(engineKindFor('fb2')).toBe('reflow');
    expect(engineKindFor('cbr')).toBe('comic');
    expect(engineKindFor('image')).toBe('comic');
  });
});
