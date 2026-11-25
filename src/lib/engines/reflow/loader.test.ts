// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptionIsDrm, fb2LooksComplete, mobiHeaderIsDrm, pdbRecordsValid } from './loader';
import { RangeFile, RangeSource } from './rangesource';

const ENC = (algo: string) =>
  `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algo}"/><enc:CipherData><enc:CipherReference URI="x"/></enc:CipherData></enc:EncryptedData></encryption>`;

describe('encryptionIsDrm', () => {
  it('font obfuscation is not DRM', () => {
    expect(encryptionIsDrm(ENC('http://www.idpf.org/2008/embedding'))).toBe(false);
    expect(encryptionIsDrm(ENC('http://ns.adobe.com/pdf/enc#RC'))).toBe(false);
  });
  it('anything else is', () => {
    expect(encryptionIsDrm(ENC('http://www.w3.org/2001/04/xmlenc#aes128-cbc'))).toBe(true);
    expect(encryptionIsDrm(ENC('http://www.w3.org/2001/04/xmlenc#aes256-cbc'))).toBe(true);
  });
  it('mixed: one protected resource is enough', () => {
    expect(encryptionIsDrm(ENC('http://www.idpf.org/2008/embedding') + ENC('http://www.w3.org/2001/04/xmlenc#aes128-cbc'))).toBe(true);
  });
  it('ignores non-EncryptionMethod Algorithm attributes (transforms) when methods are present', () => {
    const xml = `<e><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/></e>`;
    expect(encryptionIsDrm(xml)).toBe(false);
  });
  it('empty encryption.xml is fine', () => {
    expect(encryptionIsDrm('<encryption/>')).toBe(false);
  });
});

describe('mobi', () => {
  it('PalmDOC encryption flag', () => {
    const rec = new Uint8Array(16);
    expect(mobiHeaderIsDrm(rec)).toBe(false);
    rec[13] = 2;
    expect(mobiHeaderIsDrm(rec)).toBe(true);
    rec[12] = 0;
    rec[13] = 1;
    expect(mobiHeaderIsDrm(rec)).toBe(true);
    expect(mobiHeaderIsDrm(new Uint8Array(4))).toBe(false);
  });

  const pdb = (offsets: number[]) => {
    const b = new Uint8Array(78 + offsets.length * 8);
    b[76] = offsets.length >> 8;
    b[77] = offsets.length & 255;
    offsets.forEach((o, i) => new DataView(b.buffer).setUint32(78 + i * 8, o));
    return b;
  };
  it('record table validation catches truncation and disorder', () => {
    expect(pdbRecordsValid(pdb([100, 200, 300]), 400)).toBe(true);
    expect(pdbRecordsValid(pdb([100, 200, 900]), 400)).toBe(false);
    expect(pdbRecordsValid(pdb([300, 200, 100]), 400)).toBe(false);
    expect(pdbRecordsValid(pdb([100]), 400)).toBe(false);
    expect(pdbRecordsValid(new Uint8Array(10), 400)).toBe(false);
  });
});

describe('fb2LooksComplete', () => {
  it('needs the root element at both ends', () => {
    expect(fb2LooksComplete('<?xml version="1.0"?><FictionBook xmlns="x">', '</section></body></FictionBook>\n')).toBe(true);
    expect(fb2LooksComplete('<?xml version="1.0"?><FictionBook xmlns="x">', '<p>unclosed')).toBe(false);
    expect(fb2LooksComplete('<html>', '</html>')).toBe(false);
  });
});

describe('RangeSource', () => {
  const data = Uint8Array.from({ length: 3_000_000 }, (_, i) => i % 251);
  afterEach(() => vi.unstubAllGlobals());

  const serve = (opts: { ranges: boolean; calls?: string[] }) =>
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      opts.calls?.push(range ?? 'full');
      if (!range || !opts.ranges) return new Response(data.slice(), { status: 200 });
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range)!;
      const end = Math.min(Number(b), data.length - 1);
      return new Response(data.slice(Number(a), end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${a}-${end}/${data.length}` },
      });
    });

  it('reads arbitrary spans across block boundaries, caching blocks', async () => {
    const calls: string[] = [];
    serve({ ranges: true, calls });
    const src = await RangeSource.open('/x');
    expect(src.size).toBe(3_000_000);
    const a = await src.read(1_048_000, 1_049_500); // crosses the 1 MiB block edge
    expect(Array.from(a.subarray(0, 4))).toEqual(Array.from(data.subarray(1_048_000, 1_048_004)));
    expect(a.length).toBe(1500);
    expect(Array.from(a)).toEqual(Array.from(data.subarray(1_048_000, 1_049_500)));
    const n = calls.length;
    await src.read(1_048_100, 1_048_200); // cached
    expect(calls.length).toBe(n);
    expect((await src.read(2_999_990, 4_000_000)).length).toBe(10); // clamped
    expect((await src.read(5, 5)).length).toBe(0);
  });

  it('never asks for more than 8 MiB in one request', async () => {
    const calls: string[] = [];
    serve({ ranges: true, calls });
    const src = await RangeSource.open('/x');
    await src.read(0, 3_000_000);
    for (const c of calls.slice(1)) {
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(c)!;
      expect(Number(b) - Number(a) + 1).toBeLessThanOrEqual(8 * 1024 * 1024);
    }
  });

  it('falls back to memory when the server ignores Range', async () => {
    serve({ ranges: false });
    const src = await RangeSource.open('/x');
    expect(src.size).toBe(data.length);
    expect(Array.from(await src.read(10, 20))).toEqual(Array.from(data.subarray(10, 20)));
    expect((await src.blob()).size).toBe(data.length);
  });

  it('maps failures to typed errors', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404, statusText: 'Not Found' }));
    await expect(RangeSource.open('/x')).rejects.toMatchObject({ name: 'EngineError', code: 'network' });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(RangeSource.open('/x')).rejects.toMatchObject({ code: 'network' });
  });

  it('RangeFile mimics File.slice().arrayBuffer() for foliate MOBI', async () => {
    serve({ ranges: true });
    const file = new RangeFile(await RangeSource.open('/x'), 'b.mobi');
    expect(file.size).toBe(3_000_000);
    const ab = await file.slice(60, 68).arrayBuffer();
    expect(ab.byteLength).toBe(8);
    expect(Array.from(new Uint8Array(ab))).toEqual(Array.from(data.subarray(60, 68)));
    expect((await file.slice(2_999_000).arrayBuffer()).byteLength).toBe(1000); // open-ended slice
  });
});
