// Builds public/fixtures/reflow/*: EPUB 3, EPUB 2, DRM'd EPUB, corrupt EPUB, FB2, FBZ, MOBI.
// Run: node scripts/fixtures/reflow.mjs   (deterministic; outputs are committed)
import { Uint8ArrayWriter, TextReader, Uint8ArrayReader, ZipWriter, configure } from '@zip.js/zip.js';
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ch1, ch2, ch3, ch4 } from './reflow-text.mjs';
import { buildMobi } from './mobi.mjs';
import { buildAzw3 } from './kf8.mjs';

configure({ useWebWorkers: false });
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'public', 'fixtures', 'reflow');
mkdirSync(out, { recursive: true });
const DATE = new Date(Date.UTC(2024, 0, 1));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- tiny PNG (gradient) -------------------------------------------------------------------
function png(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const [r, g, b] = rgb(x / w, y / h);
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const figure = png(240, 150, (u, v) => [Math.round(40 + 120 * u), Math.round(90 + 80 * v), Math.round(170 - 70 * u)]);
const cover = png(300, 450, (u, v) => [Math.round(30 + 40 * v), Math.round(50 + 60 * u), Math.round(90 + 100 * v)]);
const font = readFileSync(join(root, 'node_modules/@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-normal.woff2'));

// --- EPUB ------------------------------------------------------------------------------------
const CSS = `@font-face { font-family: "EmbeddedFace"; src: url(../fonts/embedded.woff2) format("woff2"); }
body { font-family: Georgia, serif; color: #222222; }
h1 { font-family: "EmbeddedFace", sans-serif; font-size: 1.5em; text-align: center; margin: 1.5em 0 1em; }
p.tx { font-family: "Courier New", monospace; color: #bb0000; line-height: 1.2; margin: 0; text-indent: 1.5em; text-align: left; font-size: 12pt; }
p.first { text-indent: 0; }
blockquote.poem { margin: 1em 0 1em 2em; }
blockquote.poem p { margin: 0; text-indent: -1em; padding-left: 1em; }
pre { background: #eeeeee; color: #000000; padding: .5em; }
sup a, a.noteref { text-decoration: none; }
img.fig { display: block; margin: 1em auto; max-width: 90%; }
table.t { border-collapse: collapse; margin: 1em auto; } table.t td { border: 1px solid #888; padding: .2em .6em; }
`;

function xhtml(title, body, { epub3 = true, lang = 'en' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
${epub3 ? '<!DOCTYPE html>\n' : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n'}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="css/book.css"/></head>
<body>
${body}
</body>
</html>`;
}

const paras = (list, { first = true, note } = {}) =>
  list
    .map((t, i) => {
      const cls = i === 0 && first ? 'tx first' : 'tx';
      const text = esc(t);
      if (note && i === note.at)
        return `<p class="${cls}" id="p${i}">${text.replace(/ nerves/, ` nerves<a epub:type="noteref" role="doc-noteref" href="notes.xhtml#fn1" id="r1"><sup>1</sup></a>`)}</p>`;
      return `<p class="${cls}" id="p${i}">${text}</p>`;
    })
    .join('\n');

function chapters(epub3 = true) {
  const t = { epub3 };
  const c1 = xhtml(ch1.title, `<h1 id="ch1">${esc(ch1.title)}</h1>\n${paras(ch1.paras, { note: { at: 26 } })}\n<p class="tx"><a href="ch2.xhtml">Continue to the next chapter.</a> <a href="https://www.gutenberg.org/">Project Gutenberg</a></p>`, t);
  const c2 = xhtml(ch2.title, `<h1 id="ch2">${esc(ch2.title)}</h1>\n${paras(ch2.paras)}\n<img class="fig" src="images/figure.png" alt="A gradient figure"/>\n<p class="tx" id="after-figure">The figure above is a plain gradient bitmap.</p>\n<table class="t"><tr><td>Sea</td><td>Land</td></tr><tr><td>Whale</td><td>Counter</td></tr></table>`, t);
  const c3 = xhtml(ch3.title, `<h1 id="ch3">${esc(ch3.title)}</h1>\n${paras(ch3.paras)}\n<blockquote class="poem">\n${ch3.verse.map((v) => `<p>${esc(v)}</p>`).join('\n')}\n</blockquote>\n<pre><code>${esc(ch3.code)}</code></pre>\n${paras(ch3.more, { first: false })}`, t);
  const c4 = xhtml(ch4.title, `<h1 id="ch4">${esc(ch4.title)}</h1>\n${paras(ch4.paras)}`, t);
  const notes = xhtml('Notes', `<h1>Notes</h1>\n<aside epub:type="footnote" role="doc-footnote" id="fn1"><p class="tx"><a href="ch1.xhtml#r1" epub:type="backlink" role="doc-backlink">↩</a> In Austen’s day, “nerves” was a catch-all for fretfulness and low spirits, a polite diagnosis for a lady who was out of temper.</p></aside>`, t);
  const coverPage = xhtml('Cover', `<div style="text-align:center"><img src="images/cover.png" alt="Cover" style="max-width:100%"/></div>`, t);
  return { c1, c2, c3, c4, notes, coverPage };
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

async function zip(entries) {
  const w = new ZipWriter(new Uint8ArrayWriter(), { lastModDate: DATE, extendedTimestamp: false });
  for (const [name, data, level] of entries) {
    const reader = typeof data === 'string' ? new TextReader(data) : new Uint8ArrayReader(new Uint8Array(data));
    await w.add(name, reader, { level: level ?? 6, lastModDate: DATE, extendedTimestamp: false });
  }
  return Buffer.from(await w.close());
}

async function epub3({ drm = false } = {}) {
  const c = chapters(true);
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:5f0a3c4e-6d1b-4a7e-9c55-0d2a7b1e8f10</dc:identifier>
<dc:title>Quire Test Anthology</dc:title>
<dc:creator id="a1">Jane Austen</dc:creator><dc:creator id="a2">Herman Melville</dc:creator>
<dc:language>en</dc:language><dc:publisher>Quire Fixtures</dc:publisher>
<dc:description>Public-domain excerpts used to test the reflow engine.</dc:description>
<dc:date>2024-01-01</dc:date>
<meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
<meta property="belongs-to-collection" id="s1">Fixtures</meta><meta refines="#s1" property="collection-type">series</meta><meta refines="#s1" property="group-position">2</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="css/book.css" media-type="text/css"/>
<item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>
<item id="fig" href="images/figure.png" media-type="image/png"/>
<item id="font" href="fonts/embedded.woff2" media-type="font/woff2"/>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
<item id="ch4" href="ch4.xhtml" media-type="application/xhtml+xml"/>
<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="cover"/><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/><itemref idref="ch4"/><itemref idref="notes" linear="no"/></spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body>
<nav epub:type="toc"><h1>Contents</h1><ol>
<li><a href="ch1.xhtml">${esc(ch1.title)}</a></li>
<li><a href="ch2.xhtml">Part Two</a><ol><li><a href="ch2.xhtml">${esc(ch2.title)}</a></li><li><a href="ch3.xhtml">${esc(ch3.title)}</a></li></ol></li>
<li><a href="ch4.xhtml">${esc(ch4.title)}</a></li>
</ol></nav>
<nav epub:type="landmarks"><ol><li><a epub:type="cover" href="cover.xhtml">Cover</a></li><li><a epub:type="bodymatter" href="ch1.xhtml">Start</a></li></ol></nav>
<nav epub:type="page-list"><ol><li><a href="ch1.xhtml#p0">1</a></li><li><a href="ch2.xhtml#p0">12</a></li></ol></nav>
</body></html>`;
  const ch1doc = drm ? Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 131 + 7) & 255)) : c.c1;
  const entries = [
    ['mimetype', 'application/epub+zip', 0],
    ['META-INF/container.xml', CONTAINER],
    ...(drm
      ? [['META-INF/encryption.xml', `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/ch1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`]]
      : []),
    ['OEBPS/content.opf', opf],
    ['OEBPS/nav.xhtml', nav],
    ['OEBPS/css/book.css', CSS],
    ['OEBPS/cover.xhtml', c.coverPage],
    ['OEBPS/ch1.xhtml', ch1doc],
    ['OEBPS/ch2.xhtml', c.c2],
    ['OEBPS/ch3.xhtml', c.c3],
    ['OEBPS/ch4.xhtml', c.c4],
    ['OEBPS/notes.xhtml', c.notes],
    ['OEBPS/images/cover.png', cover],
    ['OEBPS/images/figure.png', figure],
    ['OEBPS/fonts/embedded.woff2', font],
  ];
  return zip(entries);
}

async function epub2() {
  const c = chapters(false);
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:identifier id="uid">urn:uuid:9a1c0e22-31f4-4c52-8e0b-7d4f6a2b3c11</dc:identifier>
<dc:title>Quire Legacy EPUB 2</dc:title><dc:creator opf:role="aut">Mary Shelley</dc:creator><dc:language>en</dc:language>
<meta name="cover" content="cover-img"/>
</metadata>
<manifest>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="css/book.css" media-type="text/css"/>
<item id="cover-img" href="images/cover.png" media-type="image/png"/>
<item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
<item id="ch4" href="ch4.xhtml" media-type="application/xhtml+xml"/>
<item id="fig" href="images/figure.png" media-type="image/png"/>
</manifest>
<spine toc="ncx"><itemref idref="ch3"/><itemref idref="ch4"/></spine>
<guide><reference type="cover" title="Cover" href="ch3.xhtml"/></guide>
</package>`;
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:9a1c0e22-31f4-4c52-8e0b-7d4f6a2b3c11"/></head><docTitle><text>Quire Legacy EPUB 2</text></docTitle>
<navMap>
<navPoint id="n1" playOrder="1"><navLabel><text>${esc(ch3.title)}</text></navLabel><content src="ch3.xhtml"/></navPoint>
<navPoint id="n2" playOrder="2"><navLabel><text>${esc(ch4.title)}</text></navLabel><content src="ch4.xhtml"/><navPoint id="n3" playOrder="3"><navLabel><text>Second paragraph</text></navLabel><content src="ch4.xhtml#p1"/></navPoint></navPoint>
</navMap></ncx>`;
  return zip([
    ['mimetype', 'application/epub+zip', 0],
    ['META-INF/container.xml', CONTAINER],
    ['OEBPS/content.opf', opf],
    ['OEBPS/toc.ncx', ncx],
    ['OEBPS/css/book.css', CSS],
    ['OEBPS/ch3.xhtml', c.c3],
    ['OEBPS/ch4.xhtml', c.c4],
    ['OEBPS/images/cover.png', cover],
    ['OEBPS/images/figure.png', figure],
  ]);
}

// --- FB2 -------------------------------------------------------------------------------------
function fb2() {
  const p = (t) => `<p>${esc(t)}</p>`;
  const body = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info><genre>prose_classic</genre><author><first-name>Lewis</first-name><last-name>Carroll</last-name></author><book-title>Quire FB2 Sampler</book-title><lang>en</lang>
<coverpage><image l:href="#cover.png"/></coverpage></title-info>
<document-info><author><nickname>quire</nickname></author><date value="2024-01-01">2024-01-01</date><id>quire-fb2-sampler</id><version>1.0</version></document-info>
</description>
<body>
<section><title><p>${esc(ch3.title)}</p></title>
${ch3.paras.map(p).join('\n')}
<poem><stanza>${ch3.verse.map((v) => `<v>${esc(v)}</v>`).join('')}</stanza></poem>
${p('A footnote marker follows this sentence.')}
<p>It ends here<a l:href="#n1" type="note">[1]</a>.</p>
${ch3.more.map(p).join('\n')}</section>
<section><title><p>${esc(ch4.title)}</p></title>
${ch4.paras.map(p).join('\n')}</section>
</body>
<body name="notes"><title><p>Notes</p></title><section id="n1"><title><p>1</p></title><p>The note body: a rabbit-hole in a field, very deep.</p></section></body>
<binary id="cover.png" content-type="image/png">${cover.toString('base64')}</binary>
</FictionBook>`;
  return Buffer.from(body, 'utf8');
}

const write = (name, data) => {
  writeFileSync(join(out, name), data);
  console.log(`${name.padEnd(14)} ${data.length} bytes`);
};

const good = await epub3();
write('epub3.epub', good);
write('epub2.epub', await epub2());
write('drm.epub', await epub3({ drm: true }));
write('corrupt.epub', good.subarray(0, Math.floor(good.length * 0.6)));
const fb = fb2();
write('fb2.fb2', fb);
write('fb2.fbz', await zip([['fb2.fb2', fb]]));
const mobi = buildMobi({ title: 'Quire MOBI Sampler', author: 'Mary Shelley', chapters: [ch4, ch1, ch2], language: 9 });
write('mobi.mobi', mobi);
write('azw3.azw3', buildAzw3({ title: 'Quire AZW3 Sampler', author: 'Herman Melville', chapters: [ch2, ch3, ch4] }));
write('drm.mobi', buildMobi({ title: 'Locked', author: 'Nobody', chapters: [ch4], encryption: 2 }));
write('corrupt.mobi', mobi.subarray(0, 600));
write('corrupt.fb2', Buffer.from('<?xml version="1.0"?><FictionBook><body><section><p>unclosed', 'utf8'));
